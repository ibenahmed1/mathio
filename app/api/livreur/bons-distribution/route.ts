import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';

// § /livreur/bons-distribution : historique des tournées du livreur connecté,
// ouvertes comme clôturées. Contrairement à /api/livreur/tournee (feuille de
// route, périmètre "actif" uniquement), rien n'est filtré ici : une tournée
// déchargée reste consultable avec sa reddition — côté livreur les colis
// sortent de la liste active, jamais de l'historique.
export async function GET() {
  try {
    const session = await requireUser(['livreur']);

    const data = await prisma.bonDistribution.findMany({
      where: { livreurId: session.sub },
      select: {
        id: true,
        numero: true,
        statut: true,
        nbColis: true,
        dateGeneration: true,
        dateCloture: true,
        nbColisLivres: true,
        nbColisRetournes: true,
        montantRemis: true,
        gainLivreur: true,
        hub: { select: { nom: true } },
        cloturePar: { select: { nomComplet: true } },
      },
      orderBy: { dateGeneration: 'desc' },
      take: 100,
    });

    // Solde à payer : gains des tournées clôturées pas encore réglées
    // (gainRegleLe null) — le règlement lui-même relève du Bon de paiement
    // livreur, ce module ne fait que l'alimenter.
    const aRegler = await prisma.bonDistribution.aggregate({
      where: { livreurId: session.sub, statut: 'cloture', gainRegleLe: null },
      _sum: { gainLivreur: true },
    });

    return NextResponse.json({ data, soldeAPayer: (aRegler._sum.gainLivreur ?? 0).toString() });
  } catch (error) {
    return jsonError(error);
  }
}
