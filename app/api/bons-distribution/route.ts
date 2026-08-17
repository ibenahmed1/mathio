import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { getColisEligiblesDistribution, type CommandeEligibleDistribution } from '@/lib/bon-distribution';
import { nextBonDistributionNumero } from '@/lib/codes';

export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const [data, total] = await Promise.all([
      prisma.bonDistribution.findMany({
        include: { livreur: { select: { nomComplet: true } }, hub: { select: { nom: true } } },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonDistribution.count(),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// Crée un Bon de Distribution : le bon est créé directement en base au clic
// "Valider & imprimer" (statut 'en_cours' dès la création, pas d'étape
// brouillon persistée — cf. plan) — revalide server-side chaque colis soumis
// contre l'éligibilité réelle du couple hub/livreur, même principe que
// POST /api/bons-envoi.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';
    const livreurId = typeof body.livreurId === 'string' ? body.livreurId.trim() : '';
    if (!hubId || !livreurId) {
      throw new ApiError(400, 'hubId et livreurId sont requis');
    }

    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const livreur = await prisma.utilisateur.findUnique({
      where: { id: livreurId },
      select: { id: true, nomComplet: true, role: true, actif: true },
    });
    if (!livreur || livreur.role !== 'livreur' || !livreur.actif) {
      throw new ApiError(400, 'Livreur introuvable ou inactif');
    }

    const eligibles = new Map<string, CommandeEligibleDistribution>(
      (await getColisEligiblesDistribution(hubId, livreurId)).map((c) => [c.id, c])
    );

    const colis = colisIds.map((id) => eligibles.get(id)).filter((c): c is CommandeEligibleDistribution => Boolean(c));
    if (colis.length !== colisIds.length) {
      throw new ApiError(
        409,
        "Un ou plusieurs colis sélectionnés ne sont plus éligibles pour ce livreur/ce hub (déjà pris dans un autre Bon de Distribution, ou statut changé entre-temps)"
      );
    }

    const bon = await prisma.$transaction(async (tx) => {
      const numero = await nextBonDistributionNumero(tx);

      const created = await tx.bonDistribution.create({
        data: { numero, livreurId, hubId, statut: 'en_cours', nbColis: colis.length },
      });

      await tx.commande.updateMany({
        where: { id: { in: colis.map((c) => c.id) } },
        data: { bonDistributionId: created.id, livreurId, statut: 'mise_en_distribution' },
      });

      await tx.historiqueStatutCommande.createMany({
        data: colis.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'mise_en_distribution' as const,
          utilisateurId: session.sub,
          note: `Colis affecté au Bon de Distribution ${numero} — En cours de livraison par ${livreur.nomComplet}`,
        })),
      });

      return created;
    });

    return NextResponse.json(bon, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
