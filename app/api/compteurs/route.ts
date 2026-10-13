import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_BACKOFFICE } from '@/lib/auth';
import { compterPour } from '@/lib/compteurs-nav';

// § Compteurs de la barre latérale du back-office (lib/compteurs-nav.ts) :
// chaque compte ne reçoit que ceux des liens qu'il voit.
export async function GET() {
  try {
    const session = await requireUser([...ROLES_BACKOFFICE]);
    return NextResponse.json(await compterPour(session));
  } catch (error) {
    return jsonError(error);
  }
}
