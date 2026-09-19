import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { CategorieTransaction, TypeTransaction } from '@/app/generated/prisma/enums';
import {
  CATEGORIES_TRANSACTION,
  TYPES_TRANSACTION,
  analyserPreuveComptable,
  dataUrlPreuve,
} from '@/lib/finance';

// § Comptabilité — Droits d'accès & sécurité (RBAC) : création et consultation
// réservées à admin (SUPER_ADMIN/ADMIN) et responsable (responsable comptable
// côté rôles existants, cf. TarifsVilleModal/paiement qui suit la même
// convention). Aucun autre rôle back-office (superviseur, moderateur,
// equipe_suivi) ni rôle Kanban/marchand/terrain n'y accède.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

// Adresse du justificatif d'une écriture, telle qu'exposée au client. Le
// contenu ne voyage jamais dans le JSON du journal : il est servi à la demande
// par app/api/finance/[id]/preuve/route.ts, sous les mêmes droits.
function cheminPreuve(id: string): string {
  return `/api/finance/${id}/preuve`;
}

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

    const [transactions, idsAvecPreuve, totaux] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { dateEffet: 'desc' },
        // `omit` DANS la requête, et non un tri de la réponse après coup : la
        // colonne porte la photo ENTIÈRE du justificatif en base64
        // (§ Transaction.preuveUrl). La demander ici ferait passer plusieurs
        // mégaoctets par ouverture de l'écran de comptabilité, pour une liste
        // qui n'affiche qu'une icône.
        omit: { preuveUrl: true },
        include: { auteur: { select: { nomComplet: true, role: true } } },
      }),
      // Savoir QU'UN justificatif existe ne demande pas de le lire : cette
      // requête ne ramène que des identifiants, et Postgres n'a pas à sortir
      // la valeur de son stockage TOAST pour répondre au `IS NOT NULL`.
      prisma.transaction.findMany({
        where: { ...where, preuveUrl: { not: null } },
        select: { id: true },
      }),
      // Les écritures annulées restent comptées : leur transaction de
      // compensation (montant/type inversés) neutralise déjà leur effet dans
      // la somme, sans qu'il faille les exclure explicitement (immuabilité).
      prisma.transaction.groupBy({ by: ['type'], _sum: { montant: true } }),
    ]);

    const totalEntrees = Number(totaux.find((t) => t.type === 'revenu')?._sum.montant ?? 0);
    const totalSorties = Number(totaux.find((t) => t.type === 'depense')?._sum.montant ?? 0);

    const avecPreuve = new Set(idsAvecPreuve.map((t) => t.id));

    return NextResponse.json({
      // Un POINTEUR vers la route de contenu, jamais l'octet — même convention
      // que les pièces jointes de tâche (§ PieceJointeExposee.url). `null`
      // quand l'écriture n'a pas de justificatif : le tableau n'a alors rien à
      // proposer d'ouvrir.
      data: transactions.map((t) => ({ ...t, preuve: avecPreuve.has(t.id) ? cheminPreuve(t.id) : null })),
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

    // Justificatif photo FACULTATIF (§ Transaction.preuveUrl) : une écriture
    // sans preuve est valide et complète. Mais une preuve fournie est validée
    // avant d'entrer en base — format et poids — et c'est la forme normalisée
    // qui est stockée, pas la saisie : la relecture n'a plus rien à rattraper.
    const preuveBrute = typeof body.preuveUrl === 'string' ? body.preuveUrl.trim() : '';
    let preuveUrl: string | null = null;
    if (preuveBrute) {
      const analyse = analyserPreuveComptable(preuveBrute);
      if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
      preuveUrl = dataUrlPreuve(analyse.preuve);
    }

    const transaction = await prisma.transaction.create({
      data: {
        montant,
        type,
        categorie,
        dateEffet,
        description,
        preuveUrl,
        auteurId: session.sub,
      },
      // La photo ne repart pas dans la réponse qui vient de l'écrire : le
      // client l'a déjà, et le journal ne travaille que sur le pointeur.
      omit: { preuveUrl: true },
      include: { auteur: { select: { nomComplet: true, role: true } } },
    });

    return NextResponse.json(
      { ...transaction, preuve: preuveUrl ? cheminPreuve(transaction.id) : null },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
