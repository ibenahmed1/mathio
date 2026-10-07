// § Saisie des villes — la recherche du champ ChampVille
// (components/form/ChampVille.tsx), à part pour être testée sans navigateur.
// Module PUR.

export interface OptionVille {
  valeur: string;
  libelle: string;
}

// Casse et accents repliés, ponctuation → espace. Caractère par caractère :
// l'index d'une lettre reste celui du texte d'origine, ce qui permet de
// surligner la partie tapée.
export function replier(c: string): string {
  return c.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[-'’()&.,]/g, ' ');
}

export function cleRecherche(texte: string): string {
  return [...texte].map(replier).join('').replace(/\s+/g, ' ').trim();
}

// Propositions pour ce qui est tapé : d'abord les noms qui COMMENCENT par la
// saisie, puis ceux dont un MOT commence par elle (« hoceima » → « Al Hoceima
// Ville »), puis ceux qui la CONTIENNENT. Saisie vide : toute la liste.
export function proposerVilles(saisie: string, liste: OptionVille[], max = 80): OptionVille[] {
  const q = cleRecherche(saisie);
  if (!q) return liste.slice(0, max);
  const debut: OptionVille[] = [];
  const mot: OptionVille[] = [];
  const dedans: OptionVille[] = [];
  for (const o of liste) {
    const k = cleRecherche(o.libelle);
    if (k.startsWith(q)) debut.push(o);
    else if (k.includes(` ${q}`)) mot.push(o);
    else if (k.includes(q)) dedans.push(o);
  }
  return [...debut, ...mot, ...dedans].slice(0, max);
}
