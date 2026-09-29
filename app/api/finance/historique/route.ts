import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { CibleHistoriqueComptable } from '@/app/generated/prisma/enums';
import { historiqueComptable } from '@/lib/journal-comptable';

// Historique des manipulations d'une pièce comptable (§ HistoriqueComptable).
// Lisible par quiconque lit le journal : savoir qu'une écriture a été
// réécrite, et par qui, fait partie de sa lecture — le cacher au responsable
// reviendrait à lui montrer un journal qu'il ne peut pas contrôler.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;
const CIBLES: CibleHistoriqueComptable[] = ['transaction', 'commande_stock_hub', 'categorie'];

// Même règle que le journal (§ app/api/finance/route.ts, SANS_CACHE) : une
// lecture de la comptabilité ne se sert pas depuis un cache.
const SANS_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);
    const cible = request.nextUrl.searchParams.get('cible');
    const id = request.nextUrl.searchParams.get('id');
    if (!cible || !(CIBLES as string[]).includes(cible)) throw new ApiError(400, 'Cible invalide');
    if (!id) throw new ApiError(400, 'id est requis');
    return NextResponse.json(
      { data: await historiqueComptable(cible as CibleHistoriqueComptable, id) },
      { headers: SANS_CACHE }
    );
  } catch (error) {
    return jsonError(error);
  }
}
