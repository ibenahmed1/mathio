import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { bilanBonRetour, codeSuiviDepuisScan, getBonRetour } from '@/lib/bon-retour';

// Temps 2, chez le marchand : le ramasseur scanne (ou coche) chaque colis au
// moment où il le pose sur le comptoir. Le colis passe `retourne` — c'est
// bien ici, et nulle part ailleurs, qu'un colis devient définitivement rendu
// à son marchand.
//
// Idempotent : un colis déjà remis renvoie 200 avec le bilan à jour au lieu
// d'une erreur. Un double-scan est le cas NORMAL sur le terrain (réseau
// hésitant, colis repris en main), pas une anomalie à signaler.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['ramasseur', 'admin', 'planner']);
    const { id } = await params;
    const body = await request.json();

    const bon = await prisma.bonRetour.findUnique({
      where: { id },
      select: { id: true, statut: true, ramasseurId: true, marchandId: true },
    });
    if (!bon) throw new ApiError(404, 'Bon de retour introuvable');
    if (session.role === 'ramasseur' && bon.ramasseurId !== session.sub) {
      throw new ApiError(404, 'Bon de retour introuvable');
    }
    if (bon.statut === 'nouveau') {
      throw new ApiError(409, "Ce bon n'a pas encore été confié à un ramasseur");
    }
    if (bon.statut === 'remis') {
      throw new ApiError(409, 'Ce bon est déjà clos par la signature du marchand');
    }

    const code = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    const commande = await prisma.commande.findUnique({
      where: { codeSuivi: code },
      select: { id: true, statut: true, bonRetourId: true, codeSuivi: true },
    });
    if (!commande) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    if (commande.bonRetourId !== id) {
      throw new ApiError(409, `Le colis ${commande.codeSuivi} n'appartient pas à ce bon de retour.`);
    }

    if (commande.statut !== 'retourne') {
      await prisma.$transaction(async (tx) => {
        await tx.commande.update({
          where: { id: commande.id },
          data: { statut: 'retourne' },
        });
        await tx.historiqueStatutCommande.create({
          data: {
            commandeId: commande.id,
            ancienStatut: commande.statut,
            nouveauStatut: 'retourne',
            utilisateurId: session.sub,
            note: `Colis restitué au marchand (bon de retour)`,
          },
        });
      });
    }

    const rafraichi = await getBonRetour(id);
    return NextResponse.json({ commande: { ...commande, statut: 'retourne' }, bilan: bilanBonRetour(rafraichi) });
  } catch (error) {
    return jsonError(error);
  }
}
