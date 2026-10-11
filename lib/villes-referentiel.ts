import { chargerVillesRoutage, villesRetenues } from '@/lib/hub-envoi';

// § Saisie des villes (ChampVille, components/form/ChampVille.tsx) — la liste
// proposée partout où l'on choisit une ville : colis, profil marchand, hubs,
// tarifs, filtres. Une entrée par VILLE LIVRABLE, c'est-à-dire par clé de
// routage (villesRetenues) : deux graphies d'une même ville ne s'affichent
// qu'une fois, sous le nom de la ligne que le routage retient.
//
// Rien d'autre que le nom ne sort d'ici : ni hub, ni transporteur, ni tarif —
// cette liste est servie aux marchands et au terrain.
//
// Exclues : les villes du hub de test « Hub Audit Tournée », recréé par
// scripts/test-tournee-cloture-audit.ts (même exclusion que
// scripts/auditer-conformite-sources.ts).

export async function listerVillesReferentiel(): Promise<{ nom: string }[]> {
  const villes = (await chargerVillesRoutage()).filter((v) => !v.hub.nom.startsWith('Hub Audit Tournée'));
  return [...villesRetenues(villes).values()]
    .map((v) => ({ nom: v.nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
