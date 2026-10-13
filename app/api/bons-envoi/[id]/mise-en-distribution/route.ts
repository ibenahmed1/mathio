import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';

// § Circuit transporteur (13/10/2026) — après « Bon bien reçu », les colis sont
// « Reçu au hub » de destination, chez le transporteur qui tient ce hub. Le
// passage en « Mise en distribution » est MANUEL : nous le posons quand le
// transporteur les sort en livraison. La suite (livré, refusé, reporté…)
// vient de lui — son API, son webhook, ou une saisie de notre part.
//
// Corps : { colisIds?: string[] } — absent = tous les colis du bon encore
// « Reçu au hub ».
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const demandes = parseStringIdArray(body?.colisIds);

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      select: {
        id: true,
        numero: true,
        statut: true,
        hubDestination: { select: { nom: true, prestataire: { select: { nom: true } } } },
        prestataire: { select: { nom: true } },
        commandes: { select: { id: true, codeSuivi: true, statut: true, hubActuelId: true } },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");
    if (bon.statut !== 'recu') {
      throw new ApiError(409, "Marquez d'abord le bon comme reçu : ses colis ne sont pas encore au hub de destination");
    }

    const eligibles = bon.commandes.filter((c) => c.statut === 'recu_au_hub');
    const retenus = demandes.length > 0 ? eligibles.filter((c) => demandes.includes(c.id)) : eligibles;
    if (demandes.length > 0 && retenus.length !== demandes.length) {
      throw new ApiError(409, 'Seuls les colis « Reçu au hub » de ce bon peuvent être mis en distribution');
    }
    if (retenus.length === 0) throw new ApiError(409, "Aucun colis de ce bon n'est « Reçu au hub »");

    const transporteur = bon.prestataire?.nom ?? bon.hubDestination?.prestataire?.nom ?? bon.hubDestination?.nom ?? 'le transporteur';

    const misAJour = await prisma.$transaction(async (tx) => {
      // Verrou optimiste : un double clic n'écrit qu'une fois.
      const { count } = await tx.commande.updateMany({
        where: { id: { in: retenus.map((c) => c.id) }, statut: 'recu_au_hub', bonEnvoiId: bon.id },
        data: { statut: 'mise_en_distribution' },
      });
      if (count !== retenus.length) {
        throw new ApiError(409, 'Un ou plusieurs colis viennent de changer de statut — rechargez la page');
      }
      await tx.historiqueStatutCommande.createMany({
        data: retenus.map((c) => ({
          commandeId: c.id,
          ancienStatut: 'recu_au_hub' as const,
          nouveauStatut: 'mise_en_distribution' as const,
          utilisateurId: session.sub,
          hubId: c.hubActuelId,
          note: `Mis en distribution par ${transporteur} (Bon d'Envoi ${bon.numero}) — en attente de leur retour`,
        })),
      });
      return count;
    });

    return NextResponse.json({ misEnDistribution: misAJour });
  } catch (error) {
    return jsonError(error);
  }
}
