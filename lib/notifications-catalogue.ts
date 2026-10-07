// § Notifications internes (NOTIFICATIONS.md) — le catalogue des types.
//
// Module PUR, comme lib/spaces.ts : aucun import de Prisma, de `next/*` ni de
// crypto. Il est lu par le serveur (lib/notifications.ts, qui décide de
// pousser ou non) ET par le navigateur (écran de préférences, icône de chaque
// ligne de la cloche) : une seule table, qui ne peut pas diverger.
//
// La clé est en `famille.evenement`, stockée telle quelle dans
// Notification.type et Utilisateur.pushCoupes (texte libre, cf. le schéma).
// La renommer orphelinerait l'historique : on en ajoute, on n'en renomme pas.

import type { StatutCommande } from '@/app/generated/prisma/enums';
import type { SessionSpace } from '@/lib/spaces';

export type FamilleNotification =
  | 'colis'
  | 'argent'
  | 'support'
  | 'terrain'
  | 'exploitation'
  | 'comptabilite'
  | 'taches';

export interface TypeNotificationDef {
  cle: string;
  libelle: string;
  famille: FamilleNotification;
  // L'espace de ceux qui la reçoivent : l'écran de préférences ne montre à
  // chacun que les types qui peuvent lui arriver.
  espace: SessionSpace;
  // Poussé par défaut ? `false` = cloche seulement, et le push ne peut pas y
  // être activé. Règle arrêtée le 28/09/2026 : on ne pousse aux marchands que
  // ce qui demande une réaction — un « livré » arrive par centaines dans une
  // journée et noierait les alertes qui comptent.
  push: boolean;
}

export const LIBELLES_FAMILLE: Record<FamilleNotification, string> = {
  colis: 'Suivi des colis',
  argent: 'Factures et paiements',
  support: 'Support',
  terrain: 'Tournées et ramassages',
  exploitation: 'Exploitation',
  comptabilite: 'Comptabilité',
  taches: 'Tâches',
};

export const TYPES_NOTIFICATION: TypeNotificationDef[] = [
  // --- Marchand : suivi des colis -------------------------------------------
  { cle: 'colis.livre', libelle: 'Colis livré', famille: 'colis', espace: 'marchand', push: false },
  { cle: 'colis.refuse', libelle: 'Colis refusé', famille: 'colis', espace: 'marchand', push: true },
  { cle: 'colis.retourne', libelle: 'Colis retourné', famille: 'colis', espace: 'marchand', push: true },
  // Injoignable et numéro erroné : même réaction attendue du marchand (vérifier
  // le numéro, rappeler son client), donc un seul interrupteur.
  { cle: 'colis.injoignable', libelle: 'Client injoignable ou numéro erroné', famille: 'colis', espace: 'marchand', push: true },
  { cle: 'ramassage.effectue', libelle: 'Ramassage effectué', famille: 'colis', espace: 'marchand', push: true },

  // --- Marchand : argent et support -----------------------------------------
  { cle: 'facture.emise', libelle: 'Facture émise', famille: 'argent', espace: 'marchand', push: true },
  { cle: 'facture.reglee', libelle: 'Facture réglée', famille: 'argent', espace: 'marchand', push: true },
  { cle: 'reclamation.repondue', libelle: 'Réponse à une réclamation', famille: 'support', espace: 'marchand', push: true },

  // --- Terrain --------------------------------------------------------------
  { cle: 'tournee.affectee', libelle: 'Tournée affectée', famille: 'terrain', espace: 'terrain', push: true },
  { cle: 'paiement.regle', libelle: 'Bon de paiement réglé', famille: 'terrain', espace: 'terrain', push: true },
  { cle: 'ramassage.affecte', libelle: 'Ramassage affecté', famille: 'terrain', espace: 'terrain', push: true },

  // --- Back-office ----------------------------------------------------------
  { cle: 'reclamation.nouvelle', libelle: 'Nouvelle réclamation', famille: 'exploitation', espace: 'admin', push: true },
  { cle: 'ramassage.demande', libelle: 'Nouvelle demande de ramassage', famille: 'exploitation', espace: 'admin', push: true },
  { cle: 'transporteur.erreur', libelle: 'Erreur chez un transporteur', famille: 'exploitation', espace: 'admin', push: true },
  { cle: 'hub.colis_recus', libelle: 'Colis reçus au hub', famille: 'exploitation', espace: 'admin', push: true },
  // Toute écriture du journal de la PLATEFORME (§ /admin/comptabilite) :
  // saisie, neutralisation, remise de caisse, paie, règlement de facture.
  // Les livres des boutiques n'en déclenchent pas — ce n'est pas notre caisse.
  { cle: 'comptabilite.transaction', libelle: 'Écriture comptable', famille: 'comptabilite', espace: 'admin', push: true },
  { cle: 'tache.assignee', libelle: 'Tâche qui vous est assignée', famille: 'taches', espace: 'admin', push: true },
  { cle: 'tache.mention', libelle: 'Mention dans une tâche', famille: 'taches', espace: 'admin', push: true },
  { cle: 'tache.commentaire', libelle: 'Commentaire sur votre tâche', famille: 'taches', espace: 'admin', push: true },
];

const PAR_CLE = new Map(TYPES_NOTIFICATION.map((t) => [t.cle, t]));

export function definitionNotification(cle: string): TypeNotificationDef | undefined {
  return PAR_CLE.get(cle);
}

// Le push part-il pour ce type, compte tenu des préférences du compte ? Un
// type inconnu du catalogue ne pousse jamais : c'est un historique orphelin,
// pas une alerte.
export function doitPousser(cle: string, pushCoupes: readonly string[]): boolean {
  const def = PAR_CLE.get(cle);
  return !!def && def.push && !pushCoupes.includes(cle);
}

// Ne garde des préférences reçues que les clés qui ont un sens : un type du
// catalogue, et qui pousse — couper le push d'un type « cloche seulement » ne
// voudrait rien dire. Dédupliqué, ordre du catalogue.
export function nettoyerPushCoupes(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const recues = new Set(values.filter((v): v is string => typeof v === 'string'));
  return TYPES_NOTIFICATION.filter((t) => t.push && recues.has(t.cle)).map((t) => t.cle);
}

// Espace auquel appartient un lien de notification : c'est lui qui décide
// quels appareils peuvent l'ouvrir (cf. AppareilPush.espace). `null` pour un
// lien absent ou qui ne désigne aucun espace — la notification part alors
// vers tous les appareils du compte, puisqu'elle ne mène nulle part.
// La cloche reçoit-elle ce type ? Oui, sauf si le compte l'a coupé. Un type
// inconnu du catalogue passe : on ne fait pas disparaître une notification
// parce que son type a été renommé, seules les préférences explicites comptent.
export function doitAfficher(cle: string, clocheCoupes: readonly string[]): boolean {
  return !clocheCoupes.includes(cle);
}

// Préférences de cloche reçues de l'écran : toute clé du catalogue est
// admise (y compris les types « cloche seulement », que l'on peut couper ici
// puisque c'est leur seul canal). Dédupliqué, ordre du catalogue.
export function nettoyerClocheCoupes(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const recues = new Set(values.filter((v): v is string => typeof v === 'string'));
  return TYPES_NOTIFICATION.filter((t) => recues.has(t.cle)).map((t) => t.cle);
}

export function espaceDuLien(lien: string | null | undefined): SessionSpace | null {
  if (!lien || !lien.startsWith('/')) return null;
  const premier = lien.split(/[/?#]/)[1] ?? '';
  return ESPACE_PAR_SEGMENT[premier] ?? null;
}

const ESPACE_PAR_SEGMENT: Record<string, SessionSpace> = {
  admin: 'admin',
  marchand: 'marchand',
  livreur: 'terrain',
  ramasseur: 'terrain',
};

// Préfixes des liens qu'une cloche peut ouvrir, selon l'espace qui l'affiche.
// Un compte à rôle supplémentaire (un admin qui est aussi livreur) a UNE liste
// de notifications, mais chaque cloche n'en montre que ce qu'elle sait ouvrir
// — plus celles sans lien, qui ne mènent nulle part.
export function prefixesDeLEspace(espace: SessionSpace): string[] {
  return Object.entries(ESPACE_PAR_SEGMENT)
    .filter(([, e]) => e === espace)
    .map(([segment]) => `/${segment}`);
}

// --- Contenu des notifications ------------------------------------------------

export interface NouvelleNotification {
  type: string;
  titre: string;
  corps?: string | null;
  lien?: string | null;
}

// Les statuts de colis qui valent une notification au marchand, et sous quel
// type. Les autres (ramassé, en transit, reporté…) se lisent dans le suivi et
// n'appellent pas de réaction : les notifier serait du bruit.
const TYPE_PAR_STATUT: Partial<Record<StatutCommande, string>> = {
  livre: 'colis.livre',
  refuse: 'colis.refuse',
  retourne: 'colis.retourne',
  injoignable: 'colis.injoignable',
  numero_errone: 'colis.injoignable',
};

const LIBELLE_STATUT: Partial<Record<StatutCommande, [singulier: string, pluriel: string]>> = {
  livre: ['livré', 'livrés'],
  refuse: ['refusé', 'refusés'],
  retourne: ['retourné', 'retournés'],
  injoignable: ['client injoignable', 'clients injoignables'],
  numero_errone: ['numéro erroné', 'numéros erronés'],
};

export function statutNotifie(statut: StatutCommande): boolean {
  return statut in TYPE_PAR_STATUT;
}

// Texte et lien d'une notification de statut, pour UN groupe de colis d'une
// même boutique passés au même statut. Un seul colis : son code et son
// client, lien vers sa fiche. Plusieurs : leur nombre, trois codes pour
// situer, lien vers la liste filtrée sur ce statut.
export function contenuStatutColis(
  statut: StatutCommande,
  colis: { id: string; codeSuivi: string; clientNom: string }[]
): NouvelleNotification {
  const type = TYPE_PAR_STATUT[statut] ?? `colis.${statut}`;
  const [singulier, pluriel] = LIBELLE_STATUT[statut] ?? [statut, statut];
  if (colis.length === 1) {
    const [c] = colis;
    return { type, titre: `Colis ${c.codeSuivi} : ${singulier}`, corps: c.clientNom, lien: `/marchand/colis/${c.id}` };
  }
  const codes = colis.slice(0, 3).map((c) => c.codeSuivi).join(', ');
  return {
    type,
    titre: `${colis.length} colis : ${pluriel}`,
    corps: colis.length > 3 ? `${codes}…` : codes,
    lien: `/marchand/colis?statut=${statut}`,
  };
}
