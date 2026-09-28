import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { originForHost } from '@/lib/spaces';
import { connecterBoutiqueYoucan, messageErreurConnexion, urlRetourOAuth } from '@/lib/youcan';
import { signatureRetourOAuthValide } from '@/lib/youcan-commandes';
import { COOKIE_ETAT_OAUTH, OPTIONS_COOKIE_ETAT, lireEtat } from '../etat-oauth';

// § Intégration YouCan — étape 2 d'OAuth : YouCan renvoie le navigateur ici
// avec `code` (ou `error=access_denied` si le marchand a refusé). Ce n'est pas
// une API appelée par l'écran mais une NAVIGATION : chaque issue se termine par
// une redirection vers /marchand/integrations, qui affiche le message.

function memeEtat(recu: string | null, attendu: string | undefined): boolean {
  if (!recu || !attendu) return false;
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const origine = originForHost(request.headers.get('host') ?? '');
  const retour = (issue: 'connectee' | 'erreur', message: string) => {
    const url = new URL('/marchand/integrations', origine);
    url.searchParams.set('youcan', issue);
    url.searchParams.set('message', message);
    const reponse = NextResponse.redirect(url);
    // Aléa à usage unique : effacé quelle que soit l'issue.
    reponse.cookies.set(COOKIE_ETAT_OAUTH, '', { ...OPTIONS_COOKIE_ETAT, maxAge: 0 });
    return reponse;
  };

  const params = request.nextUrl.searchParams;
  if (params.get('error')) {
    return retour(
      'erreur',
      params.get('error') === 'access_denied'
        ? 'Autorisation refusée sur YouCan : la boutique n’a pas été connectée.'
        : 'YouCan a interrompu l’autorisation. Réessayez.'
    );
  }
  // Deux preuves possibles que ce retour fait suite à NOTRE demande :
  //   - `state` identique à l'aléa scellé dans le cookie (OAuth standard) ;
  //   - à défaut — YouCan ne renvoie pas `state` (constaté le 2026-09-26) —
  //     le `hmac` signé par YouCan, un `timestamp` récent, ET la présence du
  //     cookie, qui atteste que ce navigateur a lancé la connexion il y a moins
  //     de trente minutes. La signature se vérifie avec le Client Secret que
  //     le marchand a saisi, scellé dans ce même cookie.
  const scelle = lireEtat(request.cookies.get(COOKIE_ETAT_OAUTH)?.value);
  const etat = params.get('state');
  const horodatage = Number(params.get('timestamp'));
  const recent = Number.isFinite(horodatage) && Math.abs(Date.now() / 1000 - horodatage) < 600;
  // Motif précis du refus : le marchand (et nous) savons quoi corriger.
  const refus = etat
    ? memeEtat(etat, scelle?.etat)
      ? null
      : 'Lien d’autorisation invalide'
    : !scelle
      ? 'Connexion lancée depuis un autre onglet ou il y a plus de 30 minutes'
      : !recent
        ? 'Retour de YouCan périmé'
        : !signatureRetourOAuthValide(request.nextUrl.search, scelle.clientSecret)
          ? 'Signature du retour YouCan invalide'
          : null;
  if (refus || !scelle) {
    return retour('erreur', `${refus ?? 'Connexion interrompue'} : relancez la connexion depuis cet écran.`);
  }
  const code = params.get('code');
  if (!code) return retour('erreur', 'YouCan n’a pas renvoyé de code d’autorisation. Réessayez.');

  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) return retour('erreur', 'Profil marchand introuvable');

    const identifiants = { clientId: scelle.clientId, clientSecret: scelle.clientSecret };
    const resultat = await connecterBoutiqueYoucan(marchand.id, identifiants, code, urlRetourOAuth(origine));
    const nom = resultat.nom ? ` « ${resultat.nom} »` : '';
    const produits = resultat.synchro
      ? `${resultat.synchro.variantes} article(s) du catalogue lu(s)`
      : `l’import des produits a échoué : ${resultat.erreurSynchro ?? 'raison inconnue'}`;
    return retour('connectee', `Boutique YouCan${nom} connectée ; ${produits}.`);
  } catch (error) {
    return retour('erreur', messageErreurConnexion(error));
  }
}
