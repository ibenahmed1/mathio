// Code sous lequel un colis est connu À LA FOIS chez nous et chez tous nos
// transporteurs : `MTH-PD-000123`. C'est ce code qu'on leur transmet par API
// et c'est lui que porte le QR de l'étiquette, pour que leur scanner retrouve
// le colis dans leur système comme le nôtre le retrouve chez nous.
// Pas d'import serveur ici : la normalisation sert aussi côté navigateur.

import { remettreTirets } from '@/lib/douchette';

export const PREFIXE_CODE_TRANSPORTEUR = 'MTH-';

/** `PD-000123` → `MTH-PD-000123` : le code imprimé dans le QR et envoyé aux transporteurs. */
export function codeEtiquette(codeSuivi: string): string {
  return `${PREFIXE_CODE_TRANSPORTEUR}${codeSuivi}`;
}

/** Ramène une saisie ou un scan en clair à notre codeSuivi : majuscules, et
 * `MTH-PD-000123` → `PD-000123`. Tout autre code est rendu tel quel (en
 * majuscules), le préfixe n'étant retiré que devant un `PD-`. Les « § »
 * tapés par une douchette sur Mac redeviennent des tirets. */
export function normaliserCodeColis(brut: string): string {
  const code = remettreTirets(brut.trim()).toUpperCase();
  if (code.startsWith(`${PREFIXE_CODE_TRANSPORTEUR}PD-`)) {
    return code.slice(PREFIXE_CODE_TRANSPORTEUR.length);
  }
  return code;
}
