import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import {
  getColisEligiblesDistribution,
  resolveHubPlanification,
  scopeHubBonsDistribution,
  type CommandeEligibleDistribution,
} from '@/lib/bon-distribution';
import { nextBonDistributionNumero } from '@/lib/codes';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutBonDistribution } from '@/app/generated/prisma/enums';

const STATUTS_BON_DISTRIBUTION: StatutBonDistribution[] = ['nouveau', 'en_cours', 'cloture'];

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    // Le planner ne voit que les tournées de son hub (périmètre forcé côté
    // serveur, jamais dérivé d'un paramètre de requête).
    const statutParam = searchParams.get('statut');
    const where: Prisma.BonDistributionWhereInput = {
      ...(await scopeHubBonsDistribution(session)),
      ...(statutParam && STATUTS_BON_DISTRIBUTION.includes(statutParam as StatutBonDistribution)
        ? { statut: statutParam as StatutBonDistribution }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.bonDistribution.findMany({
        where,
        include: {
          livreur: { select: { nomComplet: true } },
          hub: { select: { nom: true } },
          planner: { select: { nomComplet: true } },
          cloturePar: { select: { nomComplet: true } },
        },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonDistribution.count({ where }),
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
// POST /api/bons-envoi. Les colis affectés apparaissent immédiatement sur la
// feuille de route du livreur (§ /livreur/colis), qui interroge ses tournées
// non clôturées.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const body = await request.json();

    const hub = await resolveHubPlanification(session, typeof body.hubId === 'string' ? body.hubId : null);
    const livreurId = typeof body.livreurId === 'string' ? body.livreurId.trim() : '';
    if (!livreurId) {
      throw new ApiError(400, 'livreurId est requis');
    }

    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const [livreur, planificateur] = await Promise.all([
      prisma.utilisateur.findUnique({
        where: { id: livreurId },
        select: { id: true, nomComplet: true, role: true, actif: true },
      }),
      prisma.utilisateur.findUnique({ where: { id: session.sub }, select: { nomComplet: true } }),
    ]);
    if (!livreur || livreur.role !== 'livreur' || !livreur.actif) {
      throw new ApiError(400, 'Livreur introuvable ou inactif');
    }

    const eligibles = new Map<string, CommandeEligibleDistribution>(
      (await getColisEligiblesDistribution(hub.id, livreurId)).map((c) => [c.id, c])
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
        data: {
          numero,
          livreurId,
          hubId: hub.id,
          statut: 'en_cours',
          nbColis: colis.length,
          plannerId: session.sub,
        },
      });

      await tx.commande.updateMany({
        where: { id: { in: colis.map((c) => c.id) } },
        data: { bonDistributionId: created.id, livreurId, statut: 'mise_en_distribution' },
      });

      // Traçabilité (RG-10) : la ligne d'historique nomme la tournée, le
      // planificateur qui l'a composée et le livreur qui l'emporte — c'est
      // l'entrée "Affecté à la tournée [réf] par le Planner [nom]" attendue
      // dans le circuit du colis.
      const auteur = planificateur?.nomComplet ?? 'Planificateur';
      await tx.historiqueStatutCommande.createMany({
        data: colis.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'mise_en_distribution' as const,
          utilisateurId: session.sub,
          hubId: hub.id,
          note: `Affecté à la tournée ${numero} par ${auteur} — en cours de livraison par ${livreur.nomComplet}`,
        })),
      });

      return created;
    });

    return NextResponse.json(bon, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
