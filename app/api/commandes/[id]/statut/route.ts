import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { STATUTS_COMMANDE } from '@/lib/statuts';
import type { Role, StatutCommande } from '@/app/generated/prisma/enums';

// Rôles autorisés à changer le statut d'un colis. Contrairement à l'ancien
// pipeline logistique linéaire, le cycle "call-center" (27 statuts) n'a pas
// d'ordre strict — un agent peut passer de "Boîte vocale" à "Programmé" puis
// "Injoignable" sans séquence imposée. Le contrôle se fait donc par rôle,
// avec seulement deux garde-fous ciblés ci-dessous (preuve / motif).
// equipe_suivi reprend le périmètre de l'ancien agent_confirmation, moderateur
// celui de l'ancien sav (retours/refus) ; superviseur a une portée large.
const ROLES_AUTORISES: Role[] = ['admin', 'superviseur', 'equipe_suivi', 'livreur', 'moderateur'];

const STATUTS_REQUIS_PREUVE: StatutCommande[] = ['livre'];
const STATUTS_REQUIS_MOTIF: StatutCommande[] = ['retourne', 'refuse', 'annule', 'annule_par_vendeur'];

// La transition attente_de_ramassage -> ramasse reste réservée au scan de
// ramassage (RG-13, POST /api/commandes/scan) ; l'admin peut cependant
// l'outrepasser directement.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_AUTORISES);
    const { id } = await params;
    const body = await request.json();
    const nouveauStatut = body.statut as StatutCommande | undefined;

    if (!nouveauStatut || !STATUTS_COMMANDE.includes(nouveauStatut)) {
      throw new ApiError(400, 'Le champ statut est requis et doit être une valeur valide');
    }

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    if (
      commande.statut === 'attente_de_ramassage' &&
      nouveauStatut === 'ramasse' &&
      session.role !== 'admin'
    ) {
      throw new ApiError(
        400,
        'La transition attente_de_ramassage → ramasse ne peut pas se faire via cet endpoint pour ce rôle : elle exige un scan de ramassage (POST /api/commandes/scan).'
      );
    }

    const photoPreuveUrl = typeof body.photoPreuveUrl === 'string' ? body.photoPreuveUrl : undefined;
    const signatureUrl = typeof body.signatureUrl === 'string' ? body.signatureUrl : undefined;
    const motifRetour = typeof body.motifRetour === 'string' ? body.motifRetour.trim() : undefined;

    if (STATUTS_REQUIS_PREUVE.includes(nouveauStatut) && !photoPreuveUrl && !signatureUrl) {
      throw new ApiError(400, 'Une preuve de livraison (photo ou signature) est requise'); // RG-02
    }
    if (STATUTS_REQUIS_MOTIF.includes(nouveauStatut) && !motifRetour) {
      throw new ApiError(400, 'Un motif est requis pour ce statut'); // RG-04
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id },
        data: {
          statut: nouveauStatut,
          ...(nouveauStatut === 'ramasse' && { dateCollecte: now }),
          ...(nouveauStatut === 'livre' && { dateLivraison: now, photoPreuveUrl, signatureUrl }),
          ...(STATUTS_REQUIS_MOTIF.includes(nouveauStatut) && { motifRetour }),
        },
      });

      // RG-10 : historisation de chaque changement de statut.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: id,
          ancienStatut: commande.statut,
          nouveauStatut,
          utilisateurId: session.sub,
        },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
