import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// Composition, génération et vérification des clés d'API des plateformes
// partenaires (§ PlateformePartenaire, prisma/schema.prisma).
//
// Module séparé de `plateforme-auth.ts` pour la même raison que `spaces.ts`
// l'est de `auth.ts` : tout ce qui est ici est PUR (aucun import de Prisma ni
// de `next/*`), donc testable seul sous `tsx --test` — et le format d'une clé
// est précisément le genre de règle qu'on veut voir échouer dans un test
// plutôt qu'en production.

// --- Périmètre d'une clé ----------------------------------------------------
//
// Stocké en texte libre (CleApiPlateforme.scopes) plutôt qu'en enum Prisma :
// le catalogue évolue au rythme des endpoints, et une migration de schéma à
// chaque nouveau scope serait hors de proportion. Les valeurs inconnues sont
// écartées à la LECTURE (assainirScopes), donc un scope retiré de ce
// catalogue n'accorde plus rien, même s'il traîne encore en base.
export const CATALOGUE_SCOPES: Record<string, string> = {
  // Créer un compte marchand qui reste EN ATTENTE d'approbation, comme une
  // auto-inscription ordinaire (RF-22). C'est le scope sans danger : il ajoute
  // une demande à traiter, il n'ouvre rien.
  'marchands:creation': 'Créer un compte marchand (en attente de validation)',
  // Créer un marchand DÉJÀ VALIDÉ, sur la foi des vérifications faites par la
  // plateforme. Scope à part entière parce qu'il court-circuite RF-22 : il
  // doit pouvoir être accordé à une clé et refusé à une autre — en
  // particulier refusé à toute clé `test`, dont le propre est qu'on y essaie
  // tout (cf. creerCleApi, lib/plateformes.ts).
  //
  // La SÉPARATION des deux est ce qui rend le bac à sable utile : une clé de
  // test exerce le même endpoint, le même code, le même parcours — elle
  // n'obtient simplement pas un compte actif au bout.
  'marchands:creation_validee': 'Créer un compte marchand déjà validé',
  // Déposer des colis, à l'unité ou par lot.
  'colis:creation': 'Déposer des colis',
  // Poser un statut sur un colis CONFIÉ à un transporteur sous-traitant
  // (§ POST /api/v1/livraisons/statut). C'est le scope des clés de
  // PRESTATAIRE, et il n'a rien à faire sur une clé de plateforme de vente :
  // les deux audiences partagent la mécanique de clés, jamais le périmètre.
  //
  // À manier avec la même prudence que `marchands:creation_validee` : `livre`
  // est une écriture d'ARGENT — elle ferme le colis, déclenche sa facturation
  // au marchand et fait naître une dette COD du transporteur. Une clé qui
  // porte ce scope peut donc facturer.
  'livraisons:statut': 'Poser un statut sur un colis confié',
};

export const SCOPES_PLATEFORME = Object.keys(CATALOGUE_SCOPES);

// Scopes réservés aux comptes machine rattachés à un TRANSPORTEUR
// (PlateformePartenaire.prestataireId). Le partage s'arrête à la mécanique de
// clés : un canal de vente dépose des colis, un transporteur en déclare
// l'issue, et aucun des deux n'a rien à faire du métier de l'autre.
//
// La règle est appliquée à l'ÉMISSION de la clé (creerCleApi, lib/plateformes.ts)
// plutôt que dans les handlers : une clé qui ne détient pas le scope ne peut
// pas l'exercer, quoi qu'il arrive ensuite au code — même raisonnement que le
// refus de `marchands:creation_validee` sur une clé de test.
export const SCOPES_TRANSPORTEUR = ['livraisons:statut'];

// Scopes qu'une clé de BAC À SABLE ne peut pas recevoir. Deux entrées, deux
// raisons distinctes — et c'est la seconde qui dit la vraie limite du bac à
// sable de ce dépôt.
//
//   marchands:creation_validee  court-circuite l'approbation par un admin
//                               (RF-22). Le propre d'un environnement de test
//                               est qu'on y essaie tout ; y ouvrir un compte
//                               marchand ACTIF n'est pas un essai.
//
//   livraisons:statut           l'endpoint ne CRÉE rien, il MUTE des colis
//                               réels. Rien à marquer, rien à purger : on ne
//                               « dé-livre » pas un colis, et sa sortie des
//                               files de relance comme son entrée dans le
//                               périmètre de la facturation sont
//                               irréversibles.
//
// La distinction est structurelle. Pour une plateforme de VENTE, l'isolation
// tient parce qu'une clé `test` crée des artefacts marqués et purgeables
// (CompteMarchandExterne.environnement, § purgerDonneesTest). Pour un
// TRANSPORTEUR, il n'y a pas d'artefact : un bac à sable qui écrit en
// production n'en est pas un, et le nommer ainsi est plus dangereux que de ne
// pas en avoir.
//
// Ce que le partenaire garde en `test` : sa clé, ses en-têtes, le catalogue,
// et TOUS les refus (statut inconnu, date absente, date ambiguë, note trop
// longue, colis inconnu, lot trop grand). Ce qu'il perd : le `200 applique`.
// La répétition du chemin de succès se fait sur de vrais colis d'un marchand
// de démonstration, en `live`, sous notre contrôle.
export const SCOPES_INTERDITS_EN_TEST = ['marchands:creation_validee', 'livraisons:statut'];

// Le complément, par construction : ajouter un scope au catalogue le range du
// côté « vente » sans qu'on ait à y penser, et l'oubli irait donc toujours
// vers le moins permissif pour un transporteur.
export const SCOPES_VENTE = SCOPES_PLATEFORME.filter((s) => !SCOPES_TRANSPORTEUR.includes(s));

export type EnvironnementCle = 'live' | 'test';

export const ENVIRONNEMENTS: EnvironnementCle[] = ['live', 'test'];

// Ne garde que les scopes connus du catalogue, dédupliqués. Volontairement
// silencieux sur les inconnus (comme sanitizePermissions pour les
// permissions) : un écran d'administration d'une version antérieure ne doit
// pas se retrouver à échouer sur une clé qu'il ne sait plus nommer.
export function assainirScopes(valeurs: unknown): string[] {
  if (!Array.isArray(valeurs)) return [];
  return Array.from(
    new Set(valeurs.filter((v): v is string => typeof v === 'string' && v in CATALOGUE_SCOPES))
  );
}

// --- Format d'une clé -------------------------------------------------------
//
//   mtk_live_a7f3c19e_9kQ2xR4pLm8vNc0dW1sZ6tYbH3jF5gA7uE2iO4rT8yK
//   └┬─┘ └┬─┘ └───┬──┘ └──────────────────┬──────────────────────┘
//    │    │       │                       └─ secret : 32 octets aléatoires
//    │    │       └─ préfixe public : 4 octets hex, INDEXÉ et UNIQUE
//    │    └─ environnement, lisible à l'œil nu
//    └─ marqueur produit
//
// Le MARQUEUR sert aux scanners de secrets (GitHub secret scanning, gitleaks) :
// une chaîne aléatoire nue est indétectable, un préfixe stable est repérable
// dans un dépôt public ou un ticket de support.
//
// Le PRÉFIXE public est ce qui rend la vérification possible en une requête :
// sans lui, il faudrait comparer le hash de la clé reçue à toutes les lignes
// de la table à chaque appel.
//
// L'ENVIRONNEMENT est dans la clé pour qu'un développeur du partenaire voie
// immédiatement, en lisant sa configuration, s'il pointe sur la production —
// mais c'est la valeur EN BASE qui fait foi, jamais celle-ci (cf. le
// commentaire d'analyserCle).
const MARQUEUR = 'mtk';
const OCTETS_PREFIXE = 4;
const OCTETS_SECRET = 32;

// Le secret est en base64url, qui contient `-` et `_` : découper la clé sur
// `_` serait donc faux. L'expression est ancrée et les trois premiers groupes
// sont contraints, ce qui lève l'ambiguïté sans imposer un alphabet plus
// pauvre au secret.
const MOTIF_CLE = /^mtk_(live|test)_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export interface CleAnalysee {
  environnement: EnvironnementCle;
  prefixe: string;
  secret: string;
}

export interface CleGeneree {
  /** Valeur complète, affichée UNE SEULE FOIS au partenaire. Jamais stockée. */
  cleComplete: string;
  prefixe: string;
  secretHash: string;
}

export function genererCle(environnement: EnvironnementCle): CleGeneree {
  const prefixe = randomBytes(OCTETS_PREFIXE).toString('hex');
  const secret = randomBytes(OCTETS_SECRET).toString('base64url');
  return {
    cleComplete: `${MARQUEUR}_${environnement}_${prefixe}_${secret}`,
    prefixe,
    secretHash: hashSecretCle(secret),
  };
}

// Décompose une clé reçue. Renvoie `null` sur tout ce qui ne correspond pas
// exactement au format — un appelant n'a alors rien d'autre à faire que
// refuser.
//
// L'`environnement` renvoyé ici ne vaut PAS autorisation : il n'est qu'un
// indice porté par le client, au même titre que l'ancien en-tête `x-pd-space`
// que lib/spaces.ts a justement cessé de croire. Seul
// `CleApiPlateforme.environnement`, relu en base, décide du périmètre.
export function analyserCle(brut: string): CleAnalysee | null {
  const correspondance = MOTIF_CLE.exec(brut.trim());
  if (!correspondance) return null;
  return {
    environnement: correspondance[1] as EnvironnementCle,
    prefixe: correspondance[2],
    secret: correspondance[3],
  };
}

// SHA-256 et non bcrypt : voir CleApiPlateforme.secretHash dans
// prisma/schema.prisma pour le raisonnement (entropie du secret contre coût
// CPU par requête).
export function hashSecretCle(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// Comparaison en TEMPS CONSTANT, comme validateQrPayload (lib/parcel-serial.ts).
// Une comparaison `===` sur des chaînes s'arrête au premier caractère qui
// diffère ; sur un endpoint appelable en boucle, cette différence de durée est
// exploitable pour reconstituer un hash octet par octet.
export function secretCorrespond(secret: string, hashAttendu: string): boolean {
  const calcule = Buffer.from(hashSecretCle(secret), 'hex');
  // Un hash mal formé en base (tronqué, migré à la main) donnerait un buffer
  // de taille différente, et timingSafeEqual LÈVE dans ce cas au lieu de
  // renvoyer false.
  const attendu = Buffer.from(hashAttendu, 'hex');
  if (calcule.length !== attendu.length) return false;
  return timingSafeEqual(calcule, attendu);
}

// --- En-têtes ---------------------------------------------------------------

// `Authorization: Bearer …` est la forme documentée : standard, supportée
// nativement par tous les SDK HTTP. L'en-tête dédié est un repli toléré et
// NON documenté, pour les clients dont le proxy d'entreprise réécrit
// `Authorization`.
export const ENTETE_CLE_REPLI = 'x-mathio-api-key';

export function extraireCle(entetes: Headers): string | null {
  const autorisation = entetes.get('authorization');
  if (autorisation) {
    const correspondance = /^Bearer\s+(.+)$/i.exec(autorisation.trim());
    if (correspondance) return correspondance[1].trim();
  }
  return entetes.get(ENTETE_CLE_REPLI)?.trim() || null;
}

// En-tête de dépréciation renvoyé pendant la fenêtre de grâce qui précède
// l'expiration d'une clé : c'est ce qui rend une rotation VISIBLE dans les
// journaux du partenaire avant qu'elle ne casse chez lui.
export const ENTETE_DEPRECIATION = 'mathio-key-deprecation';
export const FENETRE_DEPRECIATION_MS = 7 * 24 * 60 * 60 * 1000;

export function depreciationImminente(expireLe: Date | null, maintenant: Date = new Date()): boolean {
  if (!expireLe) return false;
  const restant = expireLe.getTime() - maintenant.getTime();
  return restant > 0 && restant <= FENETRE_DEPRECIATION_MS;
}
