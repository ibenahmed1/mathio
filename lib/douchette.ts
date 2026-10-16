// Lecture d'un QR d'étiquette tapé par une douchette (le lecteur se comporte
// comme un clavier). Le QR contient `VILLE-CODE6-JJMMAA.SG` (lib/parcel-serial.ts,
// SG = signature de 2 caractères). Constaté le 14/10 sur la douchette du
// dépôt, poste en AZERTY, pour `AGA-JACHE8-070926.J7` :
//   « AGA-JACHE8-070926. » puis Entrée, puis « jè »
// Le point déclenche un Entrée prématuré, et la signature arrive sans Maj :
// lettre en minuscule, chiffre remplacé par le caractère AZERTY de sa touche
// (7 → è). On attend donc la signature malgré l'Entrée, puis on la retraduit.
// Depuis le 16/10, les nouvelles étiquettes portent `MTH-PD-000123`, sans point
// ni signature : lu comme un code saisi, envoyé à l'Entrée (lib/scan-colis.ts).

const SERIE_PUIS_RESTE = /^([A-Za-z]{3}-[0-9A-Za-z]{6}-\d{6})[^0-9A-Za-zàéèçÀÉÈÇ&"'(_-]?(.*)$/;

// Rangée des chiffres d'un clavier AZERTY, sans Maj.
const CHIFFRE_AZERTY: Record<string, string> = {
  '&': '1', 'é': '2', '"': '3', "'": '4', '(': '5', '-': '6', 'è': '7', '_': '8', 'ç': '9', 'à': '0',
};

// Sur Mac en AZERTY, la douchette tape « § » à la place de chaque tiret :
// `AIT§ZJRARH§151026.4E` constaté le 16/10 pour `AIT-ZJRARH-151026.4E`.
// Aucun de nos codes ne contient de « § ».
export function remettreTirets(code: string): string {
  return code.replace(/§/g, '-');
}

export type LectureDouchette =
  | { etat: 'vide' }
  /** Numéro de série reçu, signature pas encore arrivée : ne pas valider. */
  | { etat: 'attente' }
  /** `qr` : QR reconstitué, à envoyer dès qu'il est complet sans attendre Entrée. */
  | { etat: 'complet'; code: string; qr: boolean };

export function lireDouchette(valeur: string): LectureDouchette {
  const brut = remettreTirets(valeur.trim());
  if (!brut) return { etat: 'vide' };

  const m = SERIE_PUIS_RESTE.exec(brut);
  if (!m) return { etat: 'complet', code: brut, qr: false };

  const signature = Array.from(m[2])
    .map((c) => CHIFFRE_AZERTY[c] ?? c.toUpperCase())
    .filter((c) => /[0-9A-Z]/.test(c))
    .join('');
  if (signature.length < 2) return { etat: 'attente' };
  return { etat: 'complet', code: `${m[1].toUpperCase()}.${signature.slice(0, 2)}`, qr: true };
}
