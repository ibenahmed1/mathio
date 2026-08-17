import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { StatutCommandeStockHub } from '@/app/generated/prisma/enums';
import { STATUTS_COMMANDE_STOCK_HUB } from '@/lib/commandes-stock-hub';

// § Comptabilité — même périmètre d'accès que /api/finance (admin/responsable
// uniquement, cf. app/api/finance/route.ts).
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);

    const statut = request.nextUrl.searchParams.get('statut');
    const where: { statut?: StatutCommandeStockHub } = {};
    if (statut) {
      if (!STATUTS_COMMANDE_STOCK_HUB.includes(statut as StatutCommandeStockHub)) {
        throw new ApiError(400, 'Statut invalide');
      }
      where.statut = statut as StatutCommandeStockHub;
    }

    const commandes = await prisma.commandeStockHub.findMany({
      where,
      orderBy: { dateCommande: 'desc' },
      include: { auteur: { select: { nomComplet: true, role: true } } },
    });

    return NextResponse.json({ data: commandes });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);
    const body = await request.json();

    const titre = typeof body.titre === 'string' ? body.titre.trim() : '';
    const sousTitre = typeof body.sousTitre === 'string' && body.sousTitre.trim() ? body.sousTitre.trim() : null;
    const montant = Number(body.montant);
    const statut = (typeof body.statut === 'string' ? body.statut : 'en_attente') as StatutCommandeStockHub;
    const modePaiement = typeof body.modePaiement === 'string' ? body.modePaiement.trim() : '';
    const dateCommandeRaw = typeof body.dateCommande === 'string' ? body.dateCommande : null;

    if (!titre || !modePaiement || !dateCommandeRaw) {
      throw new ApiError(400, 'Titre, mode de paiement et date de commande sont requis');
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      throw new ApiError(400, 'Le montant doit être strictement positif');
    }
    if (!STATUTS_COMMANDE_STOCK_HUB.includes(statut)) {
      throw new ApiError(400, 'Statut invalide');
    }
    const dateCommande = new Date(dateCommandeRaw);
    if (Number.isNaN(dateCommande.getTime())) {
      throw new ApiError(400, 'Date de commande invalide');
    }

    const commande = await prisma.commandeStockHub.create({
      data: {
        titre,
        sousTitre,
        montant,
        statut,
        modePaiement,
        dateCommande,
        auteurId: session.sub,
      },
      include: { auteur: { select: { nomComplet: true, role: true } } },
    });

    return NextResponse.json(commande, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
