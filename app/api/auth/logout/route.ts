import { NextResponse, type NextRequest } from 'next/server';
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES, spaceForHost } from '@/lib/auth';

// Ne déconnecte que l'espace de l'hôte appelé. C'est désormais mécanique
// plutôt que déclaratif : chaque espace ayant son propre domaine, cette route
// ne peut de toute façon supprimer que les cookies de l'hôte qui la sert — un
// logout côté marchand est structurellement incapable de couper la session du
// back-office, même par erreur de code.
export async function POST(request: NextRequest) {
  const space = spaceForHost(request.headers.get('host'));
  if (!space) {
    return new NextResponse(null, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAMES[space]);
  // Reliquats d'avant la séparation par domaines (cookie unique `pd_session`,
  // puis un cookie par espace sans préfixe `__Host-`).
  for (const nom of LEGACY_SESSION_COOKIE_NAMES) {
    response.cookies.delete(nom);
  }

  return response;
}
