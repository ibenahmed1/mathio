import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission, requireUser } from '@/lib/api-utils';
import type { PorteeCategorieComptable } from '@/app/generated/prisma/enums';
import { estPorteeCategorie } from '@/lib/finance';
import { creerCategorie, listerCategories } from '@/lib/journal-comptable';

// Catégories des deux cartes de /admin/comptabilite (§ CategorieComptable).

// Lecture : quiconque saisit une écriture doit pouvoir choisir sa catégorie —
// même périmètre que le journal (cf. app/api/finance/route.ts).
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

// Même règle que le journal (§ app/api/finance/route.ts, SANS_CACHE) : une
// lecture de la comptabilité ne se sert pas depuis un cache.
const SANS_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);
    const brute = request.nextUrl.searchParams.get('portee');
    let portee: PorteeCategorieComptable | undefined;
    if (brute) {
      if (!estPorteeCategorie(brute)) throw new ApiError(400, 'Portée invalide');
      portee = brute;
    }
    return NextResponse.json({ data: await listerCategories(portee) }, { headers: SANS_CACHE });
  } catch (error) {
    return jsonError(error);
  }
}

// Création : `comptabilite:edit` — ajouter une catégorie change la grille de
// lecture des totaux, ce n'est pas un geste de saisie.
export async function POST(request: Request) {
  try {
    const session = await requirePermission('comptabilite:edit');
    const body = await request.json().catch(() => null);
    const portee: unknown = body?.portee;
    if (!estPorteeCategorie(portee)) throw new ApiError(400, 'Portée invalide');
    const categorie = await creerCategorie(body?.nom, portee, session.sub);
    return NextResponse.json(categorie, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
