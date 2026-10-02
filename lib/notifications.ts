import type { Role, StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { permissionsDuRole } from '@/lib/permissions-marchand';
import {
  contenuStatutColis,
  doitPousser,
  espaceDuLien,
  statutNotifie,
  type NouvelleNotification,
} from '@/lib/notifications-catalogue';
import { envoyerPush } from '@/lib/push-firebase';

// § Notifications internes (NOTIFICATIONS.md) — le point d'entrée unique.
//
// DEUX RÈGLES que tout appelant peut tenir pour acquises :
//
//   1. notifier() NE LÈVE JAMAIS. Une notification est une conséquence d'un
//      geste métier, pas une condition : qu'une base surchargée ou un Firebase
//      injoignable fasse échouer la livraison d'un colis serait absurde. Toute
//      erreur est journalisée et avalée ici.
//   2. On l'appelle APRÈS la transaction, jamais dedans. Dans une transaction
//      qui échoue ensuite, on aurait annoncé un événement qui n'a pas eu lieu ;
//      et un appel réseau (FCM) n'a rien à faire en tenant des verrous.
//
// La cloche (table Notification) est écrite et attendue. Le push, lui, part
// sans être attendu : il ajouterait plusieurs centaines de millisecondes à la
// réponse de l'action qui l'a déclenché, pour un effet que l'utilisateur de
// cette action ne voit même pas.

export async function notifier(
  destinataires: Iterable<string>,
  notification: NouvelleNotification,
  options: { sauf?: string | null } = {}
): Promise<void> {
  try {
    // L'auteur d'un geste n'a pas à être notifié de ce qu'il vient de faire.
    const ids = [...new Set(destinataires)].filter((id) => id && id !== options.sauf);
    if (ids.length === 0) return;

    const corps = notification.corps ?? null;
    const lien = notification.lien ?? null;
    await prisma.notification.createMany({
      data: ids.map((utilisateurId) => ({ utilisateurId, type: notification.type, titre: notification.titre, corps, lien })),
    });

    void pousser(ids, { type: notification.type, titre: notification.titre, corps, lien });
  } catch (erreur) {
    console.error('[notifications] échec de notifier()', notification.type, erreur);
  }
}

async function pousser(
  ids: string[],
  message: { type: string; titre: string; corps: string | null; lien: string | null }
): Promise<void> {
  try {
    const espace = espaceDuLien(message.lien);
    const appareils = await prisma.appareilPush.findMany({
      where: {
        utilisateurId: { in: ids },
        // Un lien /marchand/… ouvert par le service worker du domaine terrain
        // mènerait à un 404 : on ne pousse qu'aux appareils de SON espace.
        ...(espace && { espace }),
        utilisateur: { actif: true },
      },
      select: { jeton: true, utilisateur: { select: { pushCoupes: true } } },
    });
    const jetons = appareils.filter((a) => doitPousser(message.type, a.utilisateur.pushCoupes)).map((a) => a.jeton);
    if (jetons.length === 0) return;

    const issues = await envoyerPush(jetons, message);
    const morts = [...issues].filter(([, issue]) => issue === 'jeton_invalide').map(([jeton]) => jeton);
    if (morts.length > 0) {
      await prisma.appareilPush.deleteMany({ where: { jeton: { in: morts } } });
    }
  } catch (erreur) {
    console.error('[notifications] échec du push', message.type, erreur);
  }
}

// --- Qui est concerné ? -----------------------------------------------------

// Le titulaire de la boutique, et les membres de son équipe dont le rôle donne
// `permission` (§ lib/permissions-marchand.ts) — celui qui ne peut pas voir
// les factures n'a pas à apprendre qu'une facture est réglée. Seuls les
// comptes qui peuvent se connecter AUJOURD'HUI : actifs, accès non expiré.
// Une invitation pas encore acceptée ne reçoit rien, puisqu'elle n'a pas de
// cloche à ouvrir.
export async function destinatairesBoutique(marchandId: string, permission: string): Promise<string[]> {
  const boutique = await prisma.marchand.findUnique({
    where: { id: marchandId },
    select: {
      utilisateurId: true,
      utilisateur: { select: { actif: true } },
      membres: {
        select: {
          utilisateurId: true,
          accesExpireLe: true,
          modeAjout: true,
          invitationAccepteeLe: true,
          utilisateur: { select: { actif: true } },
          role: { select: { cle: true, permissions: true } },
        },
      },
    },
  });
  if (!boutique) return [];

  const maintenant = new Date();
  const ids = boutique.utilisateur.actif ? [boutique.utilisateurId] : [];
  for (const m of boutique.membres) {
    if (!m.utilisateur.actif) continue;
    if (m.accesExpireLe && m.accesExpireLe <= maintenant) continue;
    if (m.modeAjout === 'invitation' && !m.invitationAccepteeLe) continue;
    if (!permissionsDuRole(m.role).includes(permission)) continue;
    ids.push(m.utilisateurId);
  }
  return ids;
}

// Les comptes du back-office qui détiennent `permission` (§ lib/permissions.ts).
// Filtré en base : `admin` détient tout le catalogue (effectivePermissions),
// les autres ce que porte leur colonne — vide pour tout compte hors
// back-office, qui ne peut donc pas être happé ici.
export async function destinatairesBackoffice(permission: string): Promise<string[]> {
  const comptes = await prisma.utilisateur.findMany({
    where: { actif: true, OR: [{ role: 'admin' }, { permissions: { has: permission } }] },
    select: { id: true },
  });
  return comptes.map((c) => c.id);
}

// Les comptes rattachés à un hub (Utilisateur.hubId) qui y tiennent l'un des
// `roles` — en rôle principal ou supplémentaire. Le planner n'agit que sur SON
// hub : l'arrivée de colis ailleurs ne le concerne pas.
export async function destinatairesHub(hubId: string, roles: Role[]): Promise<string[]> {
  const comptes = await prisma.utilisateur.findMany({
    where: { actif: true, hubId, OR: [{ role: { in: roles } }, { rolesSupplementaires: { hasSome: roles } }] },
    select: { id: true },
  });
  return comptes.map((c) => c.id);
}

// Parmi `candidats`, ceux qui peuvent LIRE cette tâche — même règle que
// tacheAutorisee (lib/taches-scope.ts) : admin, membre de son pôle, ou
// assigné. Indispensable pour les mentions : `mentionIds` arrive du client, et
// une notification porte le texte du commentaire ; sans ce filtre, n'importe
// quel identifiant glissé dans la requête recevrait la discussion d'un pôle
// qui lui est fermé.
export async function lecteursTache(
  tache: { teamId: string; assigneeId: string | null },
  candidats: Iterable<string>
): Promise<string[]> {
  const ids = [...new Set(candidats)];
  if (ids.length === 0) return [];
  const [comptes, membres] = await Promise.all([
    prisma.utilisateur.findMany({ where: { id: { in: ids }, actif: true }, select: { id: true, role: true } }),
    prisma.equipeTacheMembre.findMany({
      where: { equipeId: tache.teamId, utilisateurId: { in: ids } },
      select: { utilisateurId: true },
    }),
  ]);
  const duPole = new Set(membres.map((m) => m.utilisateurId));
  return comptes
    .filter((c) => c.role === 'admin' || duPole.has(c.id) || c.id === tache.assigneeId)
    .map((c) => c.id);
}

// --- Factures marchand ------------------------------------------------------

function montantDh(valeur: { toString(): string }): string {
  return `${Number(valeur).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

// Relit elle-même la facture, avec un `select` EXPLICITE : numéro, boutique,
// net. Jamais un `include` ni une ligne complète — la facture porte nos coûts
// d'achat (totalCoutLivraison), qui ne doivent pas plus sortir vers un
// marchand par une notification que par l'API (cf. FACTURE_OMIT_COUTS).
export async function notifierFacture(
  factureId: string,
  evenement: 'emise' | 'reglee',
  options: { sauf?: string | null } = {}
): Promise<void> {
  try {
    const facture = await prisma.facture.findUnique({
      where: { id: factureId },
      select: { numero: true, marchandId: true, netAPayer: true },
    });
    if (!facture) return;
    await notifier(
      await destinatairesBoutique(facture.marchandId, 'factures.voir'),
      evenement === 'emise'
        ? {
            type: 'facture.emise',
            titre: `Facture ${facture.numero} émise`,
            corps: `Net à vous reverser : ${montantDh(facture.netAPayer)}`,
            lien: '/marchand/factures',
          }
        : {
            type: 'facture.reglee',
            titre: `Facture ${facture.numero} réglée`,
            corps: `Montant réglé : ${montantDh(facture.netAPayer)}`,
            lien: '/marchand/factures',
          },
      options
    );
  } catch (erreur) {
    console.error('[notifications] échec de notifierFacture()', erreur);
  }
}

// --- Colis ------------------------------------------------------------------

// À appeler après tout changement de statut d'un ou plusieurs colis, avec le
// NOUVEAU statut. Les statuts sans intérêt sont ignorés ici, pas chez
// l'appelant : un point d'écriture n'a pas à connaître la liste.
//
// Regroupé par boutique et par statut : un scan de trente colis refusés fait
// UNE notification « 30 colis refusés » par boutique, pas trente.
export async function notifierStatutsColis(
  changements: { commandeId: string; statut: StatutCommande }[],
  options: { sauf?: string | null } = {}
): Promise<void> {
  try {
    const utiles = changements.filter((c) => statutNotifie(c.statut));
    if (utiles.length === 0) return;

    const commandes = await prisma.commande.findMany({
      where: { id: { in: utiles.map((c) => c.commandeId) } },
      select: { id: true, codeSuivi: true, clientNom: true, marchandId: true },
    });
    const parId = new Map(commandes.map((c) => [c.id, c]));

    const groupes = new Map<string, { marchandId: string; statut: StatutCommande; colis: typeof commandes }>();
    for (const c of utiles) {
      const commande = parId.get(c.commandeId);
      if (!commande) continue;
      const cle = `${commande.marchandId}|${c.statut}`;
      const groupe = groupes.get(cle) ?? { marchandId: commande.marchandId, statut: c.statut, colis: [] };
      groupe.colis.push(commande);
      groupes.set(cle, groupe);
    }

    const destinatairesParBoutique = new Map<string, string[]>();
    for (const { marchandId, statut, colis } of groupes.values()) {
      let destinataires = destinatairesParBoutique.get(marchandId);
      if (!destinataires) {
        destinataires = await destinatairesBoutique(marchandId, 'colis.voir');
        destinatairesParBoutique.set(marchandId, destinataires);
      }
      await notifier(destinataires, contenuStatutColis(statut, colis), options);
    }
  } catch (erreur) {
    console.error('[notifications] échec de notifierStatutsColis()', erreur);
  }
}
