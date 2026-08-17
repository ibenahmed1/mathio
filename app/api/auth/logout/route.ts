import { NextResponse, type NextRequest } from 'next/server';
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAMES, SPACE_HINT_HEADER, type SessionSpace } from '@/lib/auth';

const VALID_SPACES: SessionSpace[] = ['admin', 'marchand', 'terrain'];

// Ne déconnecte que l'espace applicatif d'où vient la requête (indiqué par
// `x-pd-space`, posé automatiquement par lib/api-client.ts) : si un admin et
// un marchand sont connectés en même temps dans deux onglets, se déconnecter
// depuis l'espace marchand ne doit pas couper la session admin. Sans indice
// exploitable, on efface les trois par prudence.
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  const hint = request.headers.get(SPACE_HINT_HEADER);
  const space = VALID_SPACES.find((s) => s === hint);
  const spacesToClear = space ? [space] : VALID_SPACES;

  for (const s of spacesToClear) {
    response.cookies.delete(SESSION_COOKIE_NAMES[s]);
  }
  response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);

  return response;
}
