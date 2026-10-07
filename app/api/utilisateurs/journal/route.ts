import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { lireJournalEquipe } from '@/lib/journal-equipe-admin';

// § Équipe & rôles, onglet Journal : qui a fait quoi sur les comptes de
// l'équipe. Même garde que le reste de /api/utilisateurs.
export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    return NextResponse.json(await lireJournalEquipe(request.nextUrl.searchParams.get('avant')));
  } catch (error) {
    return jsonError(error);
  }
}
