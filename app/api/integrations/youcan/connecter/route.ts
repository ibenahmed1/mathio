import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { originForHost } from '@/lib/spaces';
import {
  testerIdentifiantsYoucan,
  urlAutorisation,
  urlRetourOAuth,
  validerIdentifiants,
  versApiErrorYoucan,
} from '@/lib/youcan';
import { COOKIE_ETAT_OAUTH, OPTIONS_COOKIE_ETAT, scellerEtat } from '../etat-oauth';

// § Intégration YouCan — « Connecter la boutique » : les identifiants saisis
// sont re-testés, puis scellés dans le cookie de l'aller-retour OAuth, et
// l'écran reçoit l'URL d'autorisation YouCan vers laquelle naviguer.
//
// Rien n'est enregistré ici : la boutique n'existe en base qu'au retour, une
// fois que YouCan a délivré ses jetons (../callback).
//
// L'aléa `state` est passé à YouCan par principe, mais YouCan ne le renvoie
// pas (constaté le 2026-09-26) : le retour est authentifié par sa signature.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, 'Corps JSON attendu');

    const redirection = urlRetourOAuth(originForHost(request.headers.get('host') ?? ''));
    const etat = randomBytes(24).toString('base64url');
    let url: string;
    let cookie: string;
    try {
      const identifiants = validerIdentifiants(body);
      await testerIdentifiantsYoucan(identifiants, redirection);
      url = urlAutorisation(identifiants.clientId, etat, redirection);
      cookie = scellerEtat({ etat, ...identifiants });
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
    const reponse = NextResponse.json({ url });
    reponse.cookies.set(COOKIE_ETAT_OAUTH, cookie, OPTIONS_COOKIE_ETAT);
    return reponse;
  } catch (error) {
    return jsonError(error);
  }
}
