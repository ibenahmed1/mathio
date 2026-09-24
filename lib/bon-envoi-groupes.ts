// § /admin/bon-envoi/creer, mode « Remise à un transporteur » — regroupement
// des colis proposés par le transporteur qui dessert leur ville.
//
// Module À PART, et sans aucun import : lib/bon-envoi-prestataire.ts importe
// Prisma, et ce regroupement est appelé DANS LE NAVIGATEUR par
// components/admin/BonEnvoiTransporteur.tsx. Les laisser ensemble embarquerait
// le client Prisma dans le bundle — même raison qui tient lib/spaces.ts pur.

// Clés des deux groupes qui ne désignent pas un transporteur. Préfixées pour ne
// jamais entrer en collision avec un identifiant de prestataire.
export const GROUPE_PLUSIEURS = '__plusieurs__';
export const GROUPE_AUCUN = '__aucun__';

export interface TransporteurVille {
  id: string;
  nom: string;
}

// Le minimum dont le regroupement a besoin : il ne lit rien d'autre du colis,
// et s'applique donc tel quel au DTO complet de l'écran.
export interface ColisGroupable {
  transporteursVille: TransporteurVille[];
}

export interface GroupeColis<T extends ColisGroupable> {
  cle: string;
  libelle: string;
  colis: T[];
}

/**
 * Regroupe les colis par transporteur desservant leur ville, pour que l'écran
 * montre d'un coup d'œil ce qui « revient » à qui.
 *
 * C'est un ORDRE D'AFFICHAGE, pas une règle : aucun colis n'est retiré, et
 * chacun reste sélectionnable quel que soit son groupe — confier un colis à tel
 * transporteur est un arbitrage d'exploitation, que le référentiel ne tranche
 * pas (cf. l'en-tête de lib/bon-envoi-prestataire.ts).
 *
 * L'ordre : le transporteur en cours de composition d'abord — c'est la liste
 * que l'opérateur vient chercher — puis les autres réseaux par ordre
 * alphabétique, puis les villes partagées, et enfin celles que personne
 * n'annonce. Ces deux derniers groupes restent VISIBLES et dépliés : « ville
 * non desservie » est l'information qu'on veut voir avant de confier un colis,
 * pas après.
 *
 * Une ville peut être desservie par PLUSIEURS réseaux — quatre le sont entre
 * EST et Meta, les treize de Casablanca entre notre hub interne et Power
 * (§ SOUS_TRAITANCE.md). Chaque combinaison a son propre groupe : les fondre
 * afficherait le libellé du premier colis rencontré pour tous les autres.
 */
export function regrouperParTransporteur<T extends ColisGroupable>(
  colis: T[],
  prestataireChoisiId: string | null
): GroupeColis<T>[] {
  const groupes = new Map<string, GroupeColis<T>>();

  for (const c of colis) {
    const reseaux = c.transporteursVille;
    const [cle, libelle] =
      reseaux.length === 1
        ? [reseaux[0].id, reseaux[0].nom]
        : reseaux.length > 1
          ? [`${GROUPE_PLUSIEURS}${reseaux.map((t) => t.id).sort().join('+')}`,
             `Ville partagée — ${reseaux.map((t) => t.nom).join(', ')}`]
          : [GROUPE_AUCUN, 'Ville desservie par aucun transporteur'];

    const groupe = groupes.get(cle) ?? { cle, libelle, colis: [] };
    groupe.colis.push(c);
    groupes.set(cle, groupe);
  }

  const rang = (g: GroupeColis<T>): number => {
    if (prestataireChoisiId && g.cle === prestataireChoisiId) return 0;
    if (g.cle === GROUPE_AUCUN) return 3;
    if (g.cle.startsWith(GROUPE_PLUSIEURS)) return 2;
    return 1;
  };

  return [...groupes.values()].sort(
    (a, b) => rang(a) - rang(b) || a.libelle.localeCompare(b.libelle, 'fr')
  );
}
