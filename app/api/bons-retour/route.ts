import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { resolveHubPlanification } from '@/lib/bon-distribution';
import { resolveUserHub } from '@/lib/hub-envoi';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { getColisEligiblesRetour } from '@/lib/bon-retour';
import { nextBonRetourNumero } from '@/lib/codes';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutBonRetour } from '@/app/generated/prisma/enums';

// § Bon de retour marchand (/admin/bon-retour/**).
//
// Composition réservée à admin + planner, comme le bon de distribution : les
// deux se font au hub, sur le quai, par la même personne et avec le même
// geste (scan). Le ramasseur et le marchand n'ont que des droits de lecture
// et d'avancement sur LEUR propre bon (cf. les routes dédiées).
const ROLES_COMPOSITION = ['admin', 'planner'] as const;

const STATUTS: StatutBonRetour[] = ['nouveau', 'en_cours', 'remis'];

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_COMPOSITION, 'ramasseur', 'marchand']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    let where: Prisma.BonRetourWhereInput = {};

    // Trois cloisonnements, tous résolus côté serveur — aucun identifiant de
    // périmètre n'est accepté depuis le client.
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Aucune boutique rattachée à ce compte');
      // Un bon encore `nouveau` n'a pas quitté le hub : le marchand n'a pas à
      // le voir avant qu'un ramasseur soit en route avec ses colis.
      where = { marchandId: marchand.id, statut: { in: ['en_cours', 'remis'] } };
    } else if (session.role === 'ramasseur') {
      where = { ramasseurId: session.sub };
    } else {
      // Le planner ne voit que les bons de SON hub — même confinement que
      // pour les tournées (scopeHubBonsDistribution), réécrit ici parce que
      // ce helper est typé sur BonDistribution et n'est pas transposable tel
      // quel à un autre modèle.
      if (session.role === 'planner') {
        const hub = await resolveUserHub(session.sub);
        where.hubId = hub.id;
      }
      const marchandId = searchParams.get('marchandId');
      if (marchandId) where.marchandId = marchandId;
      const ramasseurId = searchParams.get('ramasseurId');
      if (ramasseurId) where.ramasseurId = ramasseurId;
    }

    const statut = searchParams.get('statut');
    if (statut) {
      if (!STATUTS.includes(statut as StatutBonRetour)) throw new ApiError(400, 'Statut invalide');
      where.statut = statut as StatutBonRetour;
    }

    const [data, total] = await Promise.all([
      prisma.bonRetour.findMany({
        where,
        include: {
          marchand: { select: { id: true, nomBoutique: true } },
          hub: { select: { nom: true } },
          ramasseur: { select: { id: true, nomComplet: true } },
        },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonRetour.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// Crée un bon de retour. Le marchand n'est PAS un paramètre : il est déduit
// des colis soumis, et la présence de deux marchands différents est une
// erreur explicite plutôt qu'un découpage automatique — sur un quai, mieux
// vaut dire au Planner qu'il a mélangé deux lots que de créer deux bons dans
// son dos et lui en laisser un dans les mains.
//
// `ramasseurId` est OPTIONNEL et affecte le bon dans la même transaction (il
// naît alors `en_cours`). Le wizard de composition choisit le ramasseur à
// l'étape 2, avant les colis — exactement comme le bon de distribution
// choisit son livreur : le document sort des mains du Planner déjà confié à
// quelqu'un, et non « nouveau » en attente d'un second geste. Sans lui, le
// bon reste `nouveau` et passe par POST /api/bons-retour/[id]/affecter, qui
// sert aussi à la réaffectation.
export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_COMPOSITION]);
    const body = await request.json();

    const hub = await resolveHubPlanification(session, typeof body.hubId === 'string' ? body.hubId : null);

    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    // Mêmes contrôles que la route d'affectation, volontairement dupliqués
    // plutôt que factorisés : les deux chemins doivent refuser un compte
    // désactivé ou d'un autre rôle, et ce sont trois lignes.
    const ramasseurId = typeof body.ramasseurId === 'string' ? body.ramasseurId.trim() : '';
    if (ramasseurId) {
      const ramasseur = await prisma.utilisateur.findUnique({
        where: { id: ramasseurId },
        select: { id: true, role: true, actif: true, nomComplet: true },
      });
      if (!ramasseur) throw new ApiError(404, 'Ramasseur introuvable');
      if (ramasseur.role !== 'ramasseur') {
        throw new ApiError(400, "Un bon de retour ne peut être confié qu'à un compte ramasseur");
      }
      if (!ramasseur.actif) {
        throw new ApiError(400, `Le compte de ${ramasseur.nomComplet} est désactivé`);
      }
    }

    const eligibles = new Map(
      (await getColisEligiblesRetour({ hubId: hub.id })).map((c) => [c.id, c])
    );

    const colis = colisIds.map((id) => eligibles.get(id)).filter((c) => c !== undefined);
    if (colis.length !== colisIds.length) {
      throw new ApiError(
        409,
        "Un ou plusieurs colis sélectionnés ne sont plus éligibles (déjà pris dans un autre bon de retour, statut changé, ou colis absent de ce hub)"
      );
    }

    const marchandIds = new Set(colis.map((c) => c.marchandId));
    if (marchandIds.size > 1) {
      const noms = [...new Set(colis.map((c) => c.marchand.nomBoutique))].join(', ');
      throw new ApiError(
        409,
        `Ce lot mélange plusieurs marchands (${noms}). Un bon de retour ne concerne qu'un seul marchand — créez-en un par marchand.`
      );
    }

    const marchandId = colis[0].marchandId;
    const montantTotalCod = Number(colis.reduce((s, c) => s + Number(c.montantCod), 0).toFixed(2));

    const bon = await prisma.$transaction(async (tx) => {
      const numero = await nextBonRetourNumero(tx);

      const cree = await tx.bonRetour.create({
        data: {
          numero,
          marchandId,
          hubId: hub.id,
          nbColis: colis.length,
          montantTotalCod,
          creeParId: session.sub,
          ...(ramasseurId
            ? { ramasseurId, statut: 'en_cours' as const, dateAffectation: new Date() }
            : {}),
        },
      });

      // Réservation optimiste : `bonRetourId: null` dans le filtre garantit
      // qu'un colis pris par un autre bon entre-temps fait échouer tout le
      // lot au lieu d'être silencieusement volé à l'autre bon.
      const { count } = await tx.commande.updateMany({
        where: { id: { in: colis.map((c) => c.id) }, bonRetourId: null },
        data: { bonRetourId: cree.id },
      });
      if (count !== colis.length) {
        throw new ApiError(409, 'Un colis a été pris dans un autre bon entre-temps — recommencez la sélection');
      }

      return cree;
    });

    return NextResponse.json(bon, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
