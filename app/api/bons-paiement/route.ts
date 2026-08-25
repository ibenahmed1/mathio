import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import {
  bonExistantSurPeriode,
  creerBonPaiement,
  periodeDepuisParams,
  periodeMensuelle,
} from '@/lib/bon-paiement';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutBonPaiement } from '@/app/generated/prisma/enums';

// § Bon de paiement livreur (/admin/bon-paiement). Même périmètre d'accès que
// la comptabilité et la facturation : régler un livreur sort de l'argent.
const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

const STATUTS: StatutBonPaiement[] = ['brouillon', 'valide', 'paye', 'annule'];

export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const where: Prisma.BonPaiementWhereInput = {};
    const livreurId = searchParams.get('livreurId');
    if (livreurId) where.livreurId = livreurId;
    const hubId = searchParams.get('hubId');
    if (hubId) where.hubId = hubId;
    const statut = searchParams.get('statut');
    if (statut) {
      if (!STATUTS.includes(statut as StatutBonPaiement)) throw new ApiError(400, 'Statut invalide');
      where.statut = statut as StatutBonPaiement;
    }
    const periode = periodeDepuisParams(searchParams);
    if (periode) where.periodeDebut = periode.debut;

    const [data, total] = await Promise.all([
      prisma.bonPaiement.findMany({
        where,
        include: {
          livreur: { select: { id: true, nomComplet: true, telephone: true } },
          hub: { select: { nom: true } },
          emisPar: { select: { nomComplet: true } },
        },
        orderBy: [{ periodeDebut: 'desc' }, { numero: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonPaiement.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// Génère le bon de paiement d'UN livreur pour UNE période de paie, à partir de
// ses tournées clôturées dans le mois et non encore réglées. `tourneeIds` est
// optionnel : sans lui, tout le mois est pris (le cas courant, et le seul que
// produit la génération en lot).
//
// Le bon naît en BROUILLON : le comptable doit pouvoir y ajouter primes et
// pénalités avant que le montant ne soit figé par la validation.
//
// Les commissions sont la somme des gainLivreur FIGÉS à chaque clôture —
// jamais recalculées (cf. lib/bon-paiement.ts).
export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_PAIEMENT]);
    const body = await request.json();

    const livreurId = typeof body.livreurId === 'string' ? body.livreurId.trim() : '';
    if (!livreurId) throw new ApiError(400, 'livreurId est requis');
    if (typeof body.annee !== 'number' || typeof body.mois !== 'number') {
      throw new ApiError(400, 'annee et mois sont requis');
    }
    const periode = periodeMensuelle(body.annee, body.mois);

    const livreur = await prisma.utilisateur.findUnique({
      where: { id: livreurId },
      select: { id: true, nomComplet: true, role: true, hubId: true },
    });
    if (!livreur) throw new ApiError(404, 'Livreur introuvable');
    if (livreur.role !== 'livreur') {
      throw new ApiError(400, 'Un bon de paiement ne concerne que les comptes livreur');
    }

    const tourneeIds = parseStringIdArray(body.tourneeIds);

    const bon = await prisma.$transaction(async (tx) => {
      // Un seul bon vivant par (livreur, période) : la question « ce livreur
      // est-il payé pour août ? » doit avoir une réponse unique. Vérifié dans
      // la transaction — un doublon né de deux clics simultanés serait sinon
      // indétectable.
      const existant = await bonExistantSurPeriode(tx, livreurId, periode);
      if (existant) {
        throw new ApiError(
          409,
          `${livreur.nomComplet} a déjà le bon ${existant.numero} sur cette période. Annulez-le pour en régénérer un.`
        );
      }

      const cree = await creerBonPaiement(tx, {
        livreurId,
        periode,
        emisParId: session.sub,
        tourneeIds,
        hubParDefaut: livreur.hubId,
      });

      if (!cree) {
        throw new ApiError(409, "Ce livreur n'a aucune tournée à régler sur cette période");
      }
      return cree;
    });

    return NextResponse.json(bon, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
