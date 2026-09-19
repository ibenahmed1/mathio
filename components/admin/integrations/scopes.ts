import type { EnvironnementApi } from '@/lib/types';

// Catalogue des périmètres accordables à une clé d'API.
//
// Recopié depuis lib/plateforme-cles.ts plutôt qu'importé : ce module lit
// `crypto`, que le bundle client ne doit pas embarquer. La divergence est
// bornée par le test « chaque scope du catalogue porte un libellé » côté
// serveur, et par le fait qu'un scope inconnu est de toute façon écarté à
// l'émission (assainirScopes).

export interface ScopeCatalogue {
  cle: string;
  libelle: string;
  avertissement?: string;
  /** Réservé aux comptes rattachés à un transporteur. */
  transporteur?: boolean;
  /** Refusé sur une clé de bac à sable (SCOPES_INTERDITS_EN_TEST). */
  interditEnTest?: boolean;
}

export const SCOPES: ScopeCatalogue[] = [
  {
    cle: 'marchands:creation',
    libelle: 'Créer un compte marchand (en attente de validation)',
    avertissement: 'Le compte reste à approuver depuis /admin/marchands, comme une auto-inscription.',
  },
  {
    cle: 'marchands:creation_validee',
    libelle: 'Créer un compte marchand déjà validé',
    avertissement:
      'Court-circuite l’approbation par un admin (RF-22). Indisponible sur une clé de test.',
    interditEnTest: true,
  },
  { cle: 'colis:creation', libelle: 'Déposer des colis' },
  {
    cle: 'livraisons:statut',
    libelle: 'Poser un statut sur un colis confié',
    avertissement:
      'Mute des colis RÉELS : « livré » ferme le colis et le rend éligible à la facturation. Indisponible sur une clé de test — il n’y a pas de bac à sable pour ce flux.',
    transporteur: true,
    interditEnTest: true,
  },
];

/**
 * La nature d'un compte machine, telle qu'on la CHOISIT. En base elle n'existe
 * pas comme champ : elle se lit dans `PlateformePartenaire.prestataireId`
 * (§ prisma/schema.prisma). Ce type ne vit donc que le temps du formulaire.
 */
export type NaturePlateforme = 'vente' | 'transporteur';

/**
 * Les scopes de l'AUTRE nature ne sont pas grisés mais ABSENTS, et la
 * distinction est voulue : `marchands:creation_validee` redevient cochable en
 * passant la clé en `live`, alors qu'un scope de transporteur ne deviendra
 * jamais accordable sur un canal de vente. Griser ce qui ne peut pas changer
 * laisse chercher le geste qui l'ouvrirait.
 */
export function scopesDeLaNature(estTransporteur: boolean): ScopeCatalogue[] {
  return SCOPES.filter((s) => Boolean(s.transporteur) === estTransporteur);
}

/**
 * Version visible de SCOPES_INTERDITS_EN_TEST. Le refus définitif reste côté
 * serveur, à l'émission : ceci n'en est que l'écho.
 */
export function scopeInterdit(scope: string, environnement: EnvironnementApi): boolean {
  return environnement === 'test' && SCOPES.some((s) => s.cle === scope && s.interditEnTest);
}

/**
 * Code proposé d'après le nom, mais toujours modifiable : il finit dans des URL
 * et des journaux, et le deviner mal une fois se paie longtemps.
 */
export function codeDepuisNom(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
