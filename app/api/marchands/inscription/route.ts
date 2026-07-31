import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError } from '@/lib/api-utils';
import { hashSecret } from '@/lib/auth';
import { TYPES_COMPTE } from '@/lib/marchand-form-options';
import type { TypeCompteMarchand } from '@/app/generated/prisma/enums';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

// Endpoint public : auto-inscription d'un marchand (formulaire complet, cf.
// maquette). Le compte est créé désactivé (Utilisateur.actif = false) et le
// profil marchand en `en_attente_validation` (RF-22) — aucun accès tant
// qu'un admin n'a pas approuvé (dette technique corrigée : pas de compte
// "invité").
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const nomComplet = requiredString(body, 'nomComplet');
    const cin = requiredString(body, 'cin');
    const nomBoutique = requiredString(body, 'nomBoutique');
    const telephone = requiredString(body, 'telephone');
    const email = requiredString(body, 'email').toLowerCase();
    const secret = typeof body.secret === 'string' ? body.secret : '';
    const ville = requiredString(body, 'ville');
    const adresse = requiredString(body, 'adresse');
    const rib = requiredString(body, 'rib');
    const ribPhotoUrl = requiredString(body, 'ribPhotoUrl');

    const siteWeb = optionalString(body, 'siteWeb');
    const nomBanque = optionalString(body, 'nomBanque');
    const registreCommerce = optionalString(body, 'registreCommerce');
    const villeRamassage = optionalString(body, 'villeRamassage');

    const typeCompteRaw = typeof body.typeCompte === 'string' ? body.typeCompte : 'marchand';
    if (!TYPES_COMPTE.includes(typeCompteRaw as TypeCompteMarchand)) {
      throw new ApiError(400, `Type d'entreprise invalide. Valeurs possibles : ${TYPES_COMPTE.join(', ')}`);
    }
    const typeCompte = typeCompteRaw as TypeCompteMarchand;

    if (!EMAIL_REGEX.test(email)) {
      throw new ApiError(400, 'Adresse électronique invalide');
    }
    if (secret.length < 4) {
      throw new ApiError(400, 'Le mot de passe doit contenir au moins 4 caractères');
    }
    if (!RIB_REGEX.test(rib)) {
      throw new ApiError(400, 'Le RIB doit contenir exactement 24 chiffres');
    }

    const [existingTelephone, existingEmail] = await Promise.all([
      prisma.utilisateur.findUnique({ where: { telephone } }),
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
          actif: false,
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
          statut: 'en_attente_validation',
        },
      });
    });

    return NextResponse.json(
      { id: marchand.id, statut: marchand.statut, message: 'Compte créé, en attente de validation par un administrateur.' },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
