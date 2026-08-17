import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi, resolveUserHub, type CommandeEligibleEnvoi } from '@/lib/hub-envoi';
import { nextBonEnvoiNumero } from '@/lib/codes';
import type { Prisma } from '@/app/generated/prisma/client';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'agent_hub']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const where: Prisma.BonEnvoiWhereInput = {};

    // § Confinement agent_hub : ne voit que les BE destinés à son propre hub.
    if (session.role === 'agent_hub') {
      const hub = await resolveUserHub(session.sub);
      where.hubDestinationId = hub.id;
    }

    const [data, total] = await Promise.all([
      prisma.bonEnvoi.findMany({
        where,
        include: { hubDestination: { select: { nom: true } } },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonEnvoi.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// Crée un Bon d'Envoi : revalide server-side chaque colis soumis contre
// l'éligibilité réelle (ignore un état client périmé), même principe que
// creerBonDeLivraison (app/marchand/bons-livraison/actions.ts).
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const hubDestinationId = typeof body.hubDestinationId === 'string' ? body.hubDestinationId.trim() : '';
    if (!hubDestinationId) {
      throw new ApiError(400, 'hubDestinationId est requis');
    }

    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const hub = await prisma.hub.findUnique({ where: { id: hubDestinationId }, select: { id: true, nom: true } });
    if (!hub) {
      throw new ApiError(400, 'Hub introuvable');
    }

    const eligiblesPourHub = new Map<string, CommandeEligibleEnvoi>(
      (await getColisEligiblesEnvoi())
        .filter((e) => e.hub.hubId === hubDestinationId)
        .map((e) => [e.commande.id, e.commande])
    );

    const colis = colisIds.map((id) => eligiblesPourHub.get(id)).filter((c): c is CommandeEligibleEnvoi => Boolean(c));
    if (colis.length !== colisIds.length) {
      throw new ApiError(
        409,
        "Un ou plusieurs colis sélectionnés ne sont plus éligibles pour ce hub (déjà pris dans un autre Bon d'Envoi, statut changé entre-temps, ou ville hors zone)"
      );
    }

    const bon = await prisma.$transaction(async (tx) => {
      const numero = await nextBonEnvoiNumero(tx);

      const created = await tx.bonEnvoi.create({
        data: { numero, hubDestinationId, nbColis: colis.length },
      });

      await tx.commande.updateMany({
        where: { id: { in: colis.map((c) => c.id) } },
        data: { bonEnvoiId: created.id, statut: 'en_transit' },
      });

      await tx.historiqueStatutCommande.createMany({
        data: colis.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'en_transit' as const,
          utilisateurId: session.sub,
          hubId: hubDestinationId,
          note: `Colis intégré dans le Bon d'Envoi ${numero} en transit vers ${hub.nom}`,
        })),
      });

      return created;
    });

    return NextResponse.json(bon, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
