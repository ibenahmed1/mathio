import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError } from '@/lib/api-utils';
import { hashSecret, getPasswordPolicyError, normalizePhoneMaroc, isValidEmail } from '@/lib/auth';
import { TYPES_COMPTE } from '@/lib/marchand-form-options';
import type { TypeCompteMarchand } from '@/app/generated/prisma/enums';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

// 5 tentatives/minute/IP : endpoint public sans session, aussi exposé au
// bruteforce/spam qu'un login (voir critique #2 du plan sécurité).
const INSCRIPTION_RATE_LIMIT = { max: 5, windowMs: 60_000 };

const RIB_REGEX = /^\d{24}$/;

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if (!value) throw new ApiError(400, `Le champ "${key}" est requis`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  return value || null;
}

// Endpoint public : auto-inscription d'un marchand.
//
// § Inscription progressive. Trois champs suffisent — email, mot de passe,
// nom de boutique — et le compte est ACTIF immédiatement : le marchand entre
// dans son espace, saisit ses colis et invite son équipe sans attendre. Le
// reste du dossier (téléphone, CIN, ville, adresse, RIB + justificatif) se
// complète depuis son profil, et conditionne l'ouverture des bons, des
// ramassages et des factures (lib/marchand-activation.ts).
//
// RF-22 n'a pas disparu : le profil reste `en_attente_validation` et l'admin
// approuve toujours (PATCH /api/marchands/[id]/statut). Ce qui change, c'est
// que cette approbation ne barre plus la PORTE — elle barre les fonctions qui
// engagent de la marchandise ou de l'argent. Un compte non validé ne peut donc
// ni faire circuler un colis, ni être payé.
//
// Les champs du dossier restent acceptés ici quand ils sont fournis : un
// appelant qui a déjà tout sous la main (reprise d'un marchand connu, outil
// interne) crée un dossier complet d'un coup, sans passer par le profil.
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request) ?? 'unknown';
    const rateLimit = await checkRateLimit(`marchands-inscription:${ip}`, INSCRIPTION_RATE_LIMIT.max, INSCRIPTION_RATE_LIMIT.windowMs);
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterSeconds);
    }

    const body = await request.json();

    // --- Les trois champs demandés à l'inscription -------------------------
    const email = requiredString(body, 'email').toLowerCase();
    const secret = typeof body.secret === 'string' ? body.secret : '';
    const nomBoutique = requiredString(body, 'nomBoutique');

    // --- Le reste : facultatif, complété plus tard depuis le profil --------
    const nomCompletSaisi = optionalString(body, 'nomComplet');
    const telephoneSaisi = optionalString(body, 'telephone');
    const cin = optionalString(body, 'cin');
    const ville = optionalString(body, 'ville');
    const adresse = optionalString(body, 'adresse');
    const rib = optionalString(body, 'rib');
    const ribPhotoUrl = optionalString(body, 'ribPhotoUrl');
    const siteWeb = optionalString(body, 'siteWeb');
    const nomBanque = optionalString(body, 'nomBanque');
    const registreCommerce = optionalString(body, 'registreCommerce');
    const villeRamassage = optionalString(body, 'villeRamassage');
    const raisonSociale = optionalString(body, 'raisonSociale');
    const iceRc = optionalString(body, 'iceRc');

    // Utilisateur.nomComplet est NOT NULL : à défaut de nom de personne, le
    // nom de boutique est ce que le marchand nous a donné de plus proche.
    // Il le corrige depuis son profil ; ce champ ne bloque aucune fonction,
    // justement parce qu'une valeur de repli ne se distingue pas d'une saisie.
    const nomComplet = nomCompletSaisi ?? nomBoutique;

    let telephone: string | null = null;
    if (telephoneSaisi) {
      telephone = normalizePhoneMaroc(telephoneSaisi);
      if (!telephone) {
        throw new ApiError(400, 'Numéro de téléphone invalide (format marocain attendu, ex. 06XXXXXXXX)');
      }
    }

    const typeCompteRaw = typeof body.typeCompte === 'string' ? body.typeCompte : 'marchand';
    if (!TYPES_COMPTE.includes(typeCompteRaw as TypeCompteMarchand)) {
      throw new ApiError(400, `Type d'entreprise invalide. Valeurs possibles : ${TYPES_COMPTE.join(', ')}`);
    }
    const typeCompte = typeCompteRaw as TypeCompteMarchand;

    if (!isValidEmail(email)) {
      throw new ApiError(400, 'Adresse électronique invalide');
    }
    const passwordError = getPasswordPolicyError(secret);
    if (passwordError) {
      throw new ApiError(400, passwordError);
    }
    // Facultatif, mais pas relâché : un RIB fourni est un RIB valide, sinon le
    // dossier serait « complet » avec un numéro qui ne paie personne.
    if (rib && !RIB_REGEX.test(rib)) {
      throw new ApiError(400, 'Le RIB doit contenir exactement 24 chiffres');
    }

    const [existingTelephone, existingEmail] = await Promise.all([
      // Postgres autorise plusieurs NULL sous une contrainte unique : sans
      // téléphone, il n'y a rien à vérifier.
      telephone ? prisma.utilisateur.findUnique({ where: { telephone } }) : Promise.resolve(null),
      prisma.utilisateur.findUnique({ where: { email } }),
    ]);
    if (existingTelephone) {
      throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé');
    }
    if (existingEmail) {
      throw new ApiError(409, 'Cette adresse électronique est déjà utilisée');
    }

    const motDePasseHash = await hashSecret(secret);

    const marchand = await prisma.$transaction(async (tx) => {
      const utilisateur = await tx.utilisateur.create({
        data: {
          nomComplet,
          telephone,
          email,
          motDePasseHash,
          role: 'marchand',
          // Actif dès l'inscription : c'est ce qui ouvre la connexion et le
          // dashboard. Ce qu'il peut y FAIRE reste borné par le statut du
          // marchand ci-dessous et par la complétude de son dossier.
          actif: true,
        },
      });
      return tx.marchand.create({
        data: {
          utilisateurId: utilisateur.id,
          nomBoutique,
          cin,
          ville,
          adresse,
          siteWeb,
          nomBanque,
          rib,
          ribPhotoUrl,
          typeCompte,
          registreCommerce,
          villeRamassage,
          raisonSociale,
          iceRc,
          statut: 'en_attente_validation',
        },
      });
    });

    return NextResponse.json(
      {
        id: marchand.id,
        statut: marchand.statut,
        message:
          'Compte créé. Connectez-vous pour accéder à votre espace : il reste à compléter votre profil pour débloquer les bons, les ramassages et les factures.',
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
