import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import {
  etatActivationMarchand,
  messageBlocage,
  type EtatActivationMarchand,
} from '@/lib/marchand-activation';
import type { Marchand } from '@/app/generated/prisma/client';

// Résout le Marchand accessible à un utilisateur connecté avec le rôle
// "marchand" : soit le titulaire direct (Marchand.utilisateurId), soit un
// membre d'équipe invité par le titulaire (MarchandMembre). Centralise cette
// logique pour que chaque route marchand n'ait qu'à l'appeler une fois au
// lieu de refaire `prisma.marchand.findUnique({ where: { utilisateurId } })`
// et d'oublier le cas "membre".
export async function resolveMarchandForUser(utilisateurId: string): Promise<Marchand | null> {
  const direct = await prisma.marchand.findUnique({ where: { utilisateurId } });
  if (direct) return direct;

  const membre = await prisma.marchandMembre.findUnique({
    where: { utilisateurId },
    include: { marchand: true },
  });
  return membre?.marchand ?? null;
}

// § Inscription progressive — l'état d'activation du marchand connecté.
//
// Le téléphone est un champ d'Utilisateur (identifiant de connexion du
// TITULAIRE), les cinq autres champs à finaliser vivent sur Marchand : cette
// fonction fait la jointure une fois pour toutes, pour que ni les routes ni
// les écrans n'aient à la refaire — ni à oublier le téléphone en chemin.
//
// Le titulaire, pas l'utilisateur connecté : un membre d'équipe invité opère
// sur le dossier de la boutique, c'est celui-là qui doit être complet.
export async function resolveMarchandAvecEtat(
  utilisateurId: string
): Promise<{ marchand: Marchand; etat: EtatActivationMarchand } | null> {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) return null;

  const titulaire = await prisma.utilisateur.findUnique({
    where: { id: marchand.utilisateurId },
    select: { telephone: true },
  });

  const etat = etatActivationMarchand({
    profil: {
      telephone: titulaire?.telephone ?? null,
      cin: marchand.cin,
      ville: marchand.ville,
      adresse: marchand.adresse,
      rib: marchand.rib,
      ribPhotoUrl: marchand.ribPhotoUrl,
    },
    statut: marchand.statut,
  });

  return { marchand, etat };
}

// Le garde-fou serveur des fonctions réservées aux dossiers complets (bons,
// ramassages, factures). À appeler À LA PLACE de resolveMarchandForUser dans
// ces routes : le floutage côté client n'est qu'un affichage, c'est ici que
// l'accès est réellement refusé.
//
// 403 et non 404 : la fonctionnalité existe, elle n'est pas encore ouverte —
// et le message dit exactement ce qui manque pour l'ouvrir, puisque c'est ce
// que l'écran affichera.
export async function exigerMarchandOperationnel(utilisateurId: string): Promise<Marchand> {
  const resolu = await resolveMarchandAvecEtat(utilisateurId);
  if (!resolu) throw new ApiError(403, 'Profil marchand introuvable');
  if (!resolu.etat.operationnel) throw new ApiError(403, messageBlocage(resolu.etat));
  return resolu.marchand;
}
