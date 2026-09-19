import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { normaliserVille } from '../lib/hub-stock';

/**
 * Contrôle à blanc avant `npm run db:reseau` —
 * `npx tsx scripts/verifier-avant-reseau.ts`.
 *
 * STRICTEMENT EN LECTURE. Aucune écriture, aucune suppression : à lancer sur
 * une base de production avant d'y charger le référentiel, pour savoir ce que
 * l'import ferait avant qu'il le fasse.
 *
 * Il répond à trois questions :
 *   1. qu'y a-t-il déjà, qu'est-ce qui sera RÉUTILISÉ plutôt que créé, et
 *      qu'est-ce qui y est déjà rattaché ?
 *   2. un hub existant porte-t-il le même nom à la casse près ? (« hub
 *      casablanca » saisi à la main contre « Hub Casablanca » de l'import) ;
 *   3. le hub central est-il défini, et sur le bon hub ?
 *
 * Le point 2 est le piège réel : `Hub.nom` est unique au sens de PostgreSQL,
 * donc deux graphies cohabitent sans erreur. Un import qui ne rapproche pas les
 * casses crée un second hub pour la même ville — l'un reçoit les villes et les
 * tarifs, l'autre garde les colis et les utilisateurs déjà rattachés.
 *
 * SUR UN HUB QUI EXISTE DÉJÀ, l'import touche exactement DEUX choses :
 *   · son NOM, aligné sur la graphie du script quand seule la casse diffère
 *     (« hub casablanca » → « Hub Casablanca ») — un libellé, dont rien ne
 *     dépend : aucune clé étrangère ne porte le nom d'un hub ;
 *   · les VILLES qu'il lui rattache, avec leurs tarifs et leur prestataire.
 *
 * Tout le reste est laissé intact : ville-siège, adresse, téléphone,
 * rattachement à un prestataire, drapeau central (posé uniquement sur un hub que
 * l'import crée lui-même). Le hub n'est jamais supprimé et son `id` ne bouge
 * pas, si bien que tout ce qui pointe dessus reste valide — `Utilisateur.hubId`,
 * `Commande.hubActuelId`, les bons de distribution, d'envoi, de paiement, de
 * retour, et `HistoriqueStatutCommande.hubId`.
 */

// Les hubs que `db:reseau` crée, dans l'ordre des scripts. Un seul est interne.
const HUBS_ATTENDUS: { nom: string; ville: string; prestataire: string | null }[] = [
  { nom: 'Hub Casablanca', ville: 'Casablanca', prestataire: null },
  { nom: 'Agence El Jadida', ville: 'El Jadida', prestataire: 'Power Delivery' },
  { nom: 'Agence Marrakech', ville: 'Marrakech', prestataire: 'Power Delivery' },
  { nom: 'Agence Safi', ville: 'Safi', prestataire: 'Power Delivery' },
  { nom: 'Agence Rabat', ville: 'Rabat', prestataire: 'Power Delivery' },
  { nom: 'Agence Taounate', ville: 'Taounate', prestataire: 'Meta Livraison' },
  { nom: 'Agence Taza', ville: 'Taza', prestataire: 'Meta Livraison' },
  { nom: 'Agence Missour', ville: 'Missour', prestataire: 'Meta Livraison' },
  { nom: 'Agence Boulmane', ville: 'Boulmane', prestataire: 'Meta Livraison' },
  { nom: 'Agence Khemisset', ville: 'Khemisset', prestataire: 'Meta Livraison' },
  { nom: 'Agence Azrou', ville: 'Azrou', prestataire: 'Meta Livraison' },
  { nom: 'Agence Meknès', ville: 'Meknès', prestataire: 'Meta Livraison' },
  { nom: 'Agence Sefrou', ville: 'Sefrou', prestataire: 'Meta Livraison' },
  { nom: 'Agence Fès', ville: 'Fès', prestataire: 'Meta Livraison' },
  { nom: 'Agence Guelmim', ville: 'Guelmim', prestataire: 'Sahario Express' },
  { nom: 'Agence Agadir', ville: 'Agadir', prestataire: 'Sahario Express' },
  { nom: 'Agence Tanger', ville: 'Tanger', prestataire: 'Amir Livraison' },
  { nom: 'Agence Oujda', ville: 'Oujda', prestataire: 'EST Livraison' },
];

// UNE seule fonction pour le rapport lu par un humain et pour le garde-fou
// automatique du seed, plutôt qu'une détection dupliquée de chaque côté : deux
// copies auraient divergé, et c'est justement la copie silencieuse — celle du
// seed — qui aurait cessé de voir ce que le rapport signale.
//
// `afficher` ne change QUE la sortie console. Les contrôles, eux, tournent à
// l'identique dans les deux cas.
async function rapport(afficher: boolean): Promise<string[]> {
  const trace = (...lignes: unknown[]): void => {
    if (afficher) console.log(...lignes);
  };

  const [hubs, prestataires, nbVilles, nbTarifs] = await Promise.all([
    prisma.hub.findMany({
      orderBy: { nom: 'asc' },
      select: {
        nom: true,
        ville: true,
        isCentral: true,
        prestataire: { select: { nom: true } },
        _count: { select: { villes: true, agentsHub: true, commandesActuelles: true } },
      },
    }),
    prisma.prestataire.findMany({ select: { nom: true } }),
    prisma.ville.count(),
    prisma.tarifPrestataireVille.count(),
  ]);

  trace('═══ CE QU’IL Y A DÉJÀ ═══\n');
  if (hubs.length === 0) {
    trace('   Aucun hub. Base vierge : l’import créera tout, sans risque.');
  }
  for (const h of hubs) {
    trace(
      `   "${h.nom}"${h.isCentral ? ' [CENTRAL]' : ''} — ville ${h.ville} · ` +
        `${h.prestataire ? 'agence ' + h.prestataire.nom : 'interne'} · ` +
        `${h._count.villes} villes · ${h._count.agentsHub} utilisateurs · ${h._count.commandesActuelles} colis`
    );
  }
  trace(
    `\n   ${prestataires.length} prestataire(s), ${nbVilles} ville(s), ${nbTarifs} tarif(s) en base.`
  );

  trace('\n═══ CE QUE `db:reseau` FERAIT ═══\n');

  let reutilises = 0;
  let crees = 0;
  const alertes: string[] = [];

  for (const attendu of HUBS_ATTENDUS) {
    // Même résolution que resoudreHubImport : d'abord (prestataire, ville) pour
    // une agence, puis le nom à la casse près.
    const parCle = attendu.prestataire
      ? hubs.find((h) => h.prestataire?.nom === attendu.prestataire && h.ville === attendu.ville)
      : undefined;

    const parNom = hubs.find((h) => h.nom.toLowerCase() === attendu.nom.toLowerCase());
    const existant = parCle ?? parNom;

    if (!existant) {
      crees += 1;
      trace(`   + créé      "${attendu.nom}"`);
      continue;
    }

    reutilises += 1;
    const graphie =
      existant.nom === attendu.nom ? '' : `  → sera RENOMMÉ depuis "${existant.nom}" (libellé seul)`;
    trace(`   = réutilisé "${attendu.nom}"${graphie}`);

    // Ce qui est déjà accroché à ce hub. Rien de tout cela n'est modifié :
    // l'import ne fait que LIRE le hub et y rattacher de nouvelles villes. Son
    // `id` ne change pas, donc `Utilisateur.hubId`, `Commande.hubActuelId`, les
    // bons de distribution, d'envoi, de paiement et de retour, ainsi que
    // l'historique des colis, pointent toujours au même endroit.
    const { agentsHub, commandesActuelles, villes } = existant._count;
    if (agentsHub + commandesActuelles + villes > 0) {
      trace(
        `               déjà rattachés : ${agentsHub} utilisateur(s), ${commandesActuelles} colis, ` +
          `${villes} ville(s) — INTACTS, l'import n'écrit rien sur ce hub`
      );
    }

    // Un hub déjà rattaché à un AUTRE prestataire fait échouer l'import : c'est
    // volontaire, un transfert de quai est une décision humaine.
    const proprietaireActuel = existant.prestataire?.nom ?? null;
    if (proprietaireActuel !== attendu.prestataire && !parCle) {
      alertes.push(
        `"${existant.nom}" appartient à ${proprietaireActuel ?? 'l’interne'} alors que l’import l’attend chez ` +
          `${attendu.prestataire ?? 'l’interne'} — l’import s’ARRÊTERA sur cette ligne.`
      );
    }
  }

  trace(`\n   ${crees} hub(s) créé(s), ${reutilises} réutilisé(s).`);

  // Hubs présents en base que l'import ne connaît pas : ils ne sont ni touchés
  // ni supprimés, mais ils resteront à l'écran.
  const inconnus = hubs.filter(
    (h) => !HUBS_ATTENDUS.some((a) => a.nom.toLowerCase() === h.nom.toLowerCase())
  );
  if (inconnus.length > 0) {
    trace('\n   Hubs que l’import ne touche pas (ils resteront tels quels) :');
    for (const h of inconnus) trace(`      "${h.nom}" — ${h._count.villes} villes`);
  }

  trace('\n═══ HUB CENTRAL ═══\n');
  const central = hubs.find((h) => h.isCentral);
  if (central) {
    trace(`   "${central.nom}" est central. L’import n’y touchera pas.`);
  } else if (hubs.length === 0) {
    trace('   Aucun. L’import marquera "Hub Casablanca" central à sa création.');
  } else {
    trace(
      '   ⚠ AUCUN hub central, et des hubs existent déjà.\n' +
        '     L’import NE LE POSERA PAS : marquer central un hub en service changerait le\n' +
        '     comportement du système sur la foi d’un script. À cocher à la main depuis\n' +
        '     /admin/hubs — sans hub central, tout colis de stock préparé part en `en_transit`\n' +
        '     au lieu de rester au quai.'
    );
  }

  // Doublons de casse déjà présents entre eux : l'import n'en est pas la cause,
  // mais ils fausseront le routage (deux hubs pour la même ville).
  const parNomNormalise = new Map<string, string[]>();
  for (const h of hubs) {
    const cle = normaliserVille(h.nom);
    parNomNormalise.set(cle, [...(parNomNormalise.get(cle) ?? []), h.nom]);
  }
  const doublons = [...parNomNormalise.values()].filter((g) => g.length > 1);
  if (doublons.length > 0) {
    alertes.push(
      `Hubs déjà en double à la casse près : ${doublons.map((g) => g.join(' / ')).join(' ; ')}`
    );
  }

  if (alertes.length > 0) {
    trace('\n═══ À RÉGLER AVANT DE LANCER ═══\n');
    for (const a of alertes) trace(`   ⚠ ${a}`);
  } else {
    trace('\n✔ Rien ne bloque : `npm run db:reseau` peut être lancé.');
  }

  return alertes;
}

/**
 * Les seuls constats qui doivent ARRÊTER un chargement du référentiel, sans rien
 * afficher : un quai attendu chez un prestataire mais rattaché à un autre, et des
 * hubs déjà en double à la casse près. Le reste du rapport est informatif.
 *
 * Lu par `chargerReferentiel()`, qui refuse de lancer les imports si la liste
 * revient non vide.
 */
export async function detecterBlocages(): Promise<string[]> {
  return rapport(false);
}

if (lanceDirectement('verifier-avant-reseau')) {
  lancerEnCli(async () => {
    await rapport(true);
  });
}
