import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { isValidEmail, normalizePhoneMaroc } from '@/lib/auth';

async function getOwnMarchand(utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand;
}

// resolveMarchandForUser() (partagée par 20+ routes) n'inclut volontairement
// pas la relation utilisateur pour rester légère — chargée séparément ici,
// seule route qui en a besoin (affichage/édition du profil).
async function chargerUtilisateurTitulaire(utilisateurId: string) {
  return prisma.utilisateur.findUnique({
    where: { id: utilisateurId },
    select: { telephone: true, email: true },
  });
}

export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const utilisateur = await chargerUtilisateurTitulaire(marchand.utilisateurId);
    return NextResponse.json({ ...marchand, utilisateur });
  } catch (error) {
    return jsonError(error);
  }
}

// RF-24 : configuration du profil boutique et du créneau de ramassage récurrent.
export async function PATCH(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const body = await request.json();

    const data: {
      nomBoutique?: string;
      ville?: string | null;
      raisonSociale?: string | null;
      iceRc?: string | null;
      cin?: string | null;
      siteWeb?: string | null;
      adresse?: string | null;
      nomBanque?: string | null;
      rib?: string | null;
      ribPhotoUrl?: string | null;
      registreCommerce?: string | null;
      villeRamassage?: string | null;
      ramassageRecurrentActif?: boolean;
      ramassageJours?: string | null;
      ramassageCreneauHoraire?: string | null;
    } = {};

    if (typeof body.nomBoutique === 'string' && body.nomBoutique.trim()) data.nomBoutique = body.nomBoutique.trim();
    if (typeof body.ville === 'string') data.ville = body.ville.trim() || null;
    if (typeof body.raisonSociale === 'string') data.raisonSociale = body.raisonSociale.trim() || null;
    if (typeof body.iceRc === 'string') data.iceRc = body.iceRc.trim() || null;
    if (typeof body.cin === 'string') data.cin = body.cin.trim() || null;
    if (typeof body.siteWeb === 'string') data.siteWeb = body.siteWeb.trim() || null;
    if (typeof body.adresse === 'string') data.adresse = body.adresse.trim() || null;
    if (typeof body.nomBanque === 'string') data.nomBanque = body.nomBanque.trim() || null;
    if (typeof body.rib === 'string') data.rib = body.rib.trim() || null;
    if (typeof body.ribPhotoUrl === 'string' && body.ribPhotoUrl.trim()) data.ribPhotoUrl = body.ribPhotoUrl.trim();
    if (typeof body.registreCommerce === 'string') data.registreCommerce = body.registreCommerce.trim() || null;
    if (typeof body.villeRamassage === 'string') data.villeRamassage = body.villeRamassage.trim() || null;
    if (typeof body.ramassageRecurrentActif === 'boolean') data.ramassageRecurrentActif = body.ramassageRecurrentActif;
    if (typeof body.ramassageJours === 'string') data.ramassageJours = body.ramassageJours.trim() || null;
    if (typeof body.ramassageCreneauHoraire === 'string') {
      data.ramassageCreneauHoraire = body.ramassageCreneauHoraire.trim() || null;
    }

    const updated = await prisma.marchand.update({ where: { id: marchand.id }, data });

    // Téléphone/email = identifiants de connexion du TITULAIRE
    // (Marchand.utilisateurId), pas de l'utilisateur connecté en général :
    // resolveMarchandForUser() renvoie le même Marchand qu'on soit le
    // titulaire ou un membre d'équipe invité. Un membre ne doit jamais
    // pouvoir changer les identifiants de connexion du titulaire — seul
    // celui-ci (session.sub === marchand.utilisateurId) le peut.
    const estTitulaire = marchand.utilisateurId === session.sub;
    let utilisateur: { telephone: string | null; email: string | null } | null = null;

    if (estTitulaire) {
      const dataUtilisateur: { telephone?: string; email?: string } = {};

      if (typeof body.telephone === 'string' && body.telephone.trim()) {
        const telephone = normalizePhoneMaroc(body.telephone);
        if (!telephone) {
          throw new ApiError(400, 'Numéro de téléphone invalide (format marocain attendu, ex. 06XXXXXXXX)');
        }
        const existant = await prisma.utilisateur.findUnique({ where: { telephone } });
        if (existant && existant.id !== session.sub) {
          throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé');
        }
        dataUtilisateur.telephone = telephone;
      }

      if (typeof body.email === 'string' && body.email.trim()) {
        const email = body.email.trim().toLowerCase();
        if (!isValidEmail(email)) {
          throw new ApiError(400, 'Adresse électronique invalide');
        }
        const existant = await prisma.utilisateur.findUnique({ where: { email } });
        if (existant && existant.id !== session.sub) {
          throw new ApiError(409, 'Cette adresse électronique est déjà utilisée');
        }
        dataUtilisateur.email = email;
      }

      if (Object.keys(dataUtilisateur).length > 0) {
        utilisateur = await prisma.utilisateur.update({
          where: { id: session.sub },
          data: dataUtilisateur,
          select: { telephone: true, email: true },
        });
      }
    }

    if (!utilisateur) {
      utilisateur = await chargerUtilisateurTitulaire(marchand.utilisateurId);
    }

    return NextResponse.json({ ...updated, utilisateur });
  } catch (error) {
    return jsonError(error);
  }
}
