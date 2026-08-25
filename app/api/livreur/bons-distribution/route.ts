import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getPaieLivreur } from '@/lib/bon-paiement';

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

    // Solde à percevoir : délégué à getPaieLivreur plutôt que recalculé ici.
    //
    // Cet endpoint sommait auparavant les `gainLivreur` bruts des tournées
    // non réglées. Depuis les ajustements, ce chiffre ment dès qu'une pénalité
    // est saisie : le livreur lisait ses commissions, puis recevait moins,
    // sans jamais voir l'écart. Le total vient donc désormais de la même
    // source que /livreur/bons-paiement — bons émis à leur NET, plus les
    // tournées pas encore rattachées.
    const paie = await getPaieLivreur(session.sub);

    return NextResponse.json({
      data,
      soldeAPayer: paie.totalDu.toFixed(2),
      totalArrete: paie.totalArrete,
      totalNonGenere: paie.totalNonGenere,
    });
  } catch (error) {
    return jsonError(error);
  }
}
