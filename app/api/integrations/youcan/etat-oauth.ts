import { chiffrer, dechiffrer } from '@/lib/chiffrement';
import type { IdentifiantsApplication } from '@/lib/youcan';

// § Intégration YouCan — cookie qui relie l'aller et le retour OAuth.
//
// Il porte, CHIFFRÉS (AES-256-GCM, lib/chiffrement.ts), l'aléa de la demande
// et les identifiants saisis par le marchand : rien n'est écrit en base avant
// que YouCan ait délivré les jetons, et le retour (../callback) a besoin du
// Client Secret pour vérifier la signature et échanger le code.
//
// `lax` : le retour depuis YouCan est une navigation de premier niveau venue
// d'un autre site, que `strict` priverait du cookie. Trente minutes : se
// connecter à YouCan peut prendre plus de dix minutes.
export const COOKIE_ETAT_OAUTH = 'youcan_oauth_etat';

export const OPTIONS_COOKIE_ETAT = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/integrations/youcan',
  maxAge: 1800,
};

export interface EtatOAuth extends IdentifiantsApplication {
  etat: string;
}

export function scellerEtat(contenu: EtatOAuth): string {
  return chiffrer(JSON.stringify(contenu));
}

/** Contenu du cookie, ou `null` s'il est absent, altéré ou illisible. */
export function lireEtat(valeur: string | undefined): EtatOAuth | null {
  if (!valeur) return null;
  try {
    const contenu = JSON.parse(dechiffrer(valeur)) as Partial<EtatOAuth>;
    return typeof contenu.etat === 'string' &&
      typeof contenu.clientId === 'string' &&
      typeof contenu.clientSecret === 'string'
      ? (contenu as EtatOAuth)
      : null;
  } catch {
    return null;
  }
}
