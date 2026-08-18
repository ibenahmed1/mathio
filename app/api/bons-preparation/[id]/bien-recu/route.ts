import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// § Gestion de stock (/admin/stock/bons-preparation/[id]) : "Bon bien reçu" —
// même action et même mécanisme que POST /api/bons-livraison/[id]/bien-recu,
// pour que le Bon de Préparation suive exactement le même cycle qu'un Bon de
// Livraison (première version manuelle du système, pas de routage
// hub-central/agent dédié). Les colis du bon, mis à "attente_de_ramassage" à
// la création du BPR (cf. POST /api/bons-preparation), passent ici à
// "ramasse" — l'équivalent, pour un colis stock déjà à l'entrepôt, de la
// prise en charge terrain d'un colis marchand normal — puis rejoignent le
// pipeline colis générique (recu, expedie, livre…) et la liste globale.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonDePreparation.findUnique({
      where: { id },
      include: { commandes: true },
    });
    if (!bon) throw new ApiError(404, 'Bon de préparation introuvable');
    if (bon.statut === 'validee') throw new ApiError(400, 'Ce bon de préparation est déjà reçu');

    const eligibles = bon.commandes.filter((c) => c.statut === 'attente_de_ramassage');
    if (eligibles.length === 0) {
      throw new ApiError(400, "Aucun colis de ce bon n'est en attente de réception");
    }

    await prisma.$transaction(async (tx) => {
      await tx.commande.updateMany({
        where: { id: { in: eligibles.map((c) => c.id) } },
        data: { statut: 'ramasse' },
      });
      await tx.historiqueStatutCommande.createMany({
        data: eligibles.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'ramasse' as const,
          utilisateurId: session.sub,
        })),
      });
      await tx.bonDePreparation.update({
        where: { id },
        data: { statut: 'validee', dateValidation: new Date(), validateurId: session.sub },
      });
    });

    const bonMisAJour = await prisma.bonDePreparation.findUnique({
      where: { id },
      include: {
        marchand: { select: { nomBoutique: true } },
        validateur: { select: { nomComplet: true } },
        commandes: { include: { produit: { select: { id: true, nom: true, reference: true, photoUrl: true } } } },
      },
    });
    return NextResponse.json(bonMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
