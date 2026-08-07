import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { Role } from '@/app/generated/prisma/enums';

// Mêmes jeux de rôles que POST /api/utilisateurs (voir ce fichier pour le
// détail) : seuls les comptes équipe se modifient/suppriment depuis cet
// écran — pas admin (pas géré via l'API) ni marchand (a son propre CRUD,
// /api/marchands/:id, qui cascade sur l'utilisateur lié).
const ROLES_EQUIPE: Role[] = [
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'ramasseur',
  'livreur',
  'design',
  'gestionnaire_hub',
];
const ROLES_TERRAIN: Role[] = ['ramasseur', 'livreur'];
const ROLES_AVEC_PHOTO: Role[] = ['ramasseur', 'livreur', 'moderateur'];

// RF-22 : modification d'un compte équipe par l'admin (identité + champs
// terrain le cas échéant). Le mot de passe se change via l'endpoint dédié
// /reinitialiser-mot-de-passe, pas ici.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) {
      throw new ApiError(404, 'Utilisateur introuvable');
    }
    if (!ROLES_EQUIPE.includes(utilisateur.role)) {
      throw new ApiError(400, 'Ce compte ne peut pas être modifié depuis cet écran');
    }

    const role = (body.role as Role | undefined) ?? utilisateur.role;
    if (!ROLES_EQUIPE.includes(role)) {
      throw new ApiError(400, `Rôle invalide. Valeurs possibles : ${ROLES_EQUIPE.join(', ')}`);
    }
    const estTerrain = ROLES_TERRAIN.includes(role);
    const avecPhoto = ROLES_AVEC_PHOTO.includes(role);

    const data: Prisma.UtilisateurUpdateInput = { role };

    if (typeof body.nomComplet === 'string' && body.nomComplet.trim()) {
      data.nomComplet = body.nomComplet.trim();
    }

    if (typeof body.telephone === 'string' && body.telephone.trim()) {
      const telephone = body.telephone.trim();
      if (telephone !== utilisateur.telephone) {
        const existing = await prisma.utilisateur.findUnique({ where: { telephone } });
        if (existing) throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé');
      }
      data.telephone = telephone;
    }

    if (typeof body.email === 'string') {
      const email = body.email.trim();
      if (email && email !== utilisateur.email) {
        const existing = await prisma.utilisateur.findUnique({ where: { email } });
        if (existing) throw new ApiError(409, 'Cette adresse électronique est déjà utilisée');
      }
      data.email = email || null;
    }

    if (avecPhoto && typeof body.photoUrl === 'string') {
      data.photoUrl = body.photoUrl || null;
    }
    if (!avecPhoto) {
      data.photoUrl = null;
    }

    if (estTerrain) {
      if (typeof body.cin === 'string') data.cin = body.cin.trim() || null;
      if (typeof body.adresse === 'string') data.adresse = body.adresse.trim() || null;
      if (typeof body.nomBanque === 'string') data.nomBanque = body.nomBanque.trim() || null;
      if (typeof body.numeroCompte === 'string') data.numeroCompte = body.numeroCompte.trim() || null;
      if (typeof body.zonePrincipale === 'string') data.zonePrincipale = body.zonePrincipale.trim() || null;
      if (typeof body.zoneSecondaire === 'string') data.zoneSecondaire = body.zoneSecondaire.trim() || null;
      if (typeof body.cinRectoUrl === 'string') data.cinRectoUrl = body.cinRectoUrl || null;
      if (typeof body.cinVersoUrl === 'string') data.cinVersoUrl = body.cinVersoUrl || null;
      if (typeof body.ribPhotoUrl === 'string') data.ribPhotoUrl = body.ribPhotoUrl || null;
      if (body.fraisLivraison !== undefined) {
        data.fraisLivraison = body.fraisLivraison === '' || body.fraisLivraison === null ? null : Number(body.fraisLivraison);
      }
      if (body.fraisRefus !== undefined) {
        data.fraisRefus = body.fraisRefus === '' || body.fraisRefus === null ? null : Number(body.fraisRefus);
      }
    } else {
      // Rôle non-terrain (superviseur/moderateur/equipe_suivi/responsable) :
      // efface les champs terrain qui ne s'appliquent plus si le rôle a changé.
      data.cin = null;
      data.adresse = null;
      data.nomBanque = null;
      data.numeroCompte = null;
      data.fraisLivraison = null;
      data.fraisRefus = null;
      data.zonePrincipale = null;
      data.zoneSecondaire = null;
      data.cinRectoUrl = null;
      data.cinVersoUrl = null;
      data.ribPhotoUrl = null;
    }

    const updated = await prisma.utilisateur.update({
      where: { id },
      data,
      select: {
        id: true,
        nomComplet: true,
        telephone: true,
        email: true,
        role: true,
        actif: true,
        photoUrl: true,
        cin: true,
        adresse: true,
        nomBanque: true,
        numeroCompte: true,
        fraisLivraison: true,
        fraisRefus: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

// RF-22 : suppression définitive d'un compte équipe. Si des colis/ramassages
// sont liés (FK RESTRICT), on renvoie une erreur explicite plutôt qu'un 500 —
// l'admin doit alors désactiver le compte plutôt que le supprimer.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    if (id === session.sub) {
      throw new ApiError(400, 'Vous ne pouvez pas supprimer votre propre compte');
    }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) {
      throw new ApiError(404, 'Utilisateur introuvable');
    }
    if (!ROLES_EQUIPE.includes(utilisateur.role)) {
      throw new ApiError(400, 'Ce compte ne peut pas être supprimé depuis cet écran');
    }

    try {
      await prisma.utilisateur.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(
          409,
          'Impossible de supprimer : ce compte a des colis, ramassages ou tarifs liés — désactivez-le plutôt'
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
