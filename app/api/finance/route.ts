import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { CategorieTransaction, TypeTransaction } from '@/app/generated/prisma/enums';
import { CATEGORIES_TRANSACTION, TYPES_TRANSACTION } from '@/lib/finance';

// § Comptabilité — Droits d'accès & sécurité (RBAC) : création et consultation
// réservées à admin (SUPER_ADMIN/ADMIN) et responsable (responsable comptable
// côté rôles existants, cf. TarifsVilleModal/paiement qui suit la même
// convention). Aucun autre rôle back-office (superviseur, moderateur,
// equipe_suivi) ni rôle Kanban/marchand/terrain n'y accède.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);

    const type = request.nextUrl.searchParams.get('type');
    const categorie = request.nextUrl.searchParams.get('categorie');

    const where: { type?: TypeTransaction; categorie?: CategorieTransaction } = {};
    if (type) {
      if (!TYPES_TRANSACTION.includes(type as TypeTransaction)) throw new ApiError(400, 'Type de transaction invalide');
      where.type = type as TypeTransaction;
    }
    if (categorie) {
      if (!CATEGORIES_TRANSACTION.includes(categorie as CategorieTransaction)) {
        throw new ApiError(400, 'Catégorie de transaction invalide');
      }
      where.categorie = categorie as CategorieTransaction;
    }

    const [transactions, totaux] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { dateEffet: 'desc' },
        include: { auteur: { select: { nomComplet: true, role: true } } },
      }),
      // Les écritures annulées restent comptées : leur transaction de
      // compensation (montant/type inversés) neutralise déjà leur effet dans
      // la somme, sans qu'il faille les exclure explicitement (immuabilité).
      prisma.transaction.groupBy({ by: ['type'], _sum: { montant: true } }),
    ]);

    const totalEntrees = Number(totaux.find((t) => t.type === 'revenu')?._sum.montant ?? 0);
    const totalSorties = Number(totaux.find((t) => t.type === 'depense')?._sum.montant ?? 0);

    return NextResponse.json({
      data: transactions,
      totaux: {
        totalEntrees,
        totalSorties,
        solde: totalEntrees - totalSorties,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);
    const body = await request.json();

    const montant = Number(body.montant);
    const type = body.type as TypeTransaction | undefined;
    const categorie = body.categorie as CategorieTransaction | undefined;
    const dateEffetRaw = typeof body.dateEffet === 'string' ? body.dateEffet : null;
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;

    if (!Number.isFinite(montant) || !type || !categorie || !dateEffetRaw) {
      throw new ApiError(400, 'Montant, type, catégorie et date sont requis');
    }
    // RG § Contrôle des saisies : uniquement un montant absolu positif, c'est
    // le choix du type qui détermine si l'écriture ajoute ou soustrait.
    if (montant <= 0) {
      throw new ApiError(400, 'Le montant doit être strictement positif');
    }
    if (!TYPES_TRANSACTION.includes(type)) {
      throw new ApiError(400, 'Type de transaction invalide');
    }
    if (!CATEGORIES_TRANSACTION.includes(categorie)) {
      throw new ApiError(400, 'Catégorie de transaction invalide');
    }
    const dateEffet = new Date(dateEffetRaw);
    if (Number.isNaN(dateEffet.getTime())) {
      throw new ApiError(400, 'Date d\'effet invalide');
    }

    const transaction = await prisma.transaction.create({
      data: {
        montant,
        type,
        categorie,
        dateEffet,
        description,
        auteurId: session.sub,
      },
      include: { auteur: { select: { nomComplet: true, role: true } } },
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
