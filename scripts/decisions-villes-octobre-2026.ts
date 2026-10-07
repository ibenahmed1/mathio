import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { HUB_CENTRAL, nomHubActuel } from '../lib/hubs-regionaux';

/**
 * Décisions de référentiel des 2 et 3 octobre 2026, § /admin/hubs.
 *
 *   npx tsx scripts/decisions-villes-octobre-2026.ts            (à blanc : n'écrit rien)
 *   npx tsx scripts/decisions-villes-octobre-2026.ts --oui      (applique)
 *   npx tsx scripts/decisions-villes-octobre-2026.ts --oui --forcer
 *                     (applique même si des tournées internes de Casablanca sont ouvertes)
 *
 * Ce que l'exploitation a décidé :
 *
 *   1. CASABLANCA PASSE À POWER DELIVERY. Le Hub Casablanca (interne) ne
 *      dessert plus aucune ville : ses villes sont retirées, et leurs colis
 *      rattachés à la ville du même nom de l'Agence Casablanca (Power). Le hub
 *      lui-même RESTE — c'est le hub central (réception, stock, départ des bons
 *      d'envoi). Conséquence : le routage envoie Casablanca chez Power, et la
 *      marge compte désormais 15 dh (Casablanca) ou 20 dh (les autres) par
 *      colis livré.
 *   2. Villes retirées de la grille Power : « moulay brahim » (Marrakech) et
 *      « SIDI HAJAJ » (Casablanca).
 *   3. « l jadida » (Agence El Jadida) est fusionnée dans « El Jadida », qui
 *      prend son tarif : 20 dh.
 *   4. Oujda (EST Livraison) : 15 dh, retour 0 dh comme le reste de leur grille.
 *   5. (05/10/2026) Taourirt, Tahla, Bouhlou, Aknoul, Ajdir Taza et Oued Amlil
 *      ne sont plus desservies que par EST Livraison : retirées de l'Agence
 *      Taza (Meta), leurs colis rattachés à la ville EST correspondante.
 *   6. (05/10/2026) Sidi Ifni et Mirleft restent à Sahario Express seul :
 *      « sidi fini » et « merleft » sont retirées de l'Agence Agadir (Leader
 *      Colis), leurs colis rattachés à la ville Sahario.
 *   7. (05/10/2026) Missour, Boulmane, Guigou, Timahdit et Outat el haj restent
 *      à Meta Livraison seul : retirées de l'Agence Errachidia (Colivraison),
 *      leurs colis rattachés à la ville Meta.
 *   8. (05/10/2026) Le retour est à 0 dh chez TOUS les transporteurs : tout
 *      tarif de retour absent ou différent est mis à 0. Un colis retourné a
 *      donc un coût connu (0) au lieu d'un coût inconnu à la facturation.
 *   9. (07/10/2026) Taza et Guercif ne sont plus desservies que par EST
 *      Livraison : « TAZA » et « GUERCIF » retirées de l'Agence Taza (Meta),
 *      leurs colis rattachés à « Taza Ville » / « Guercif Ville » (EST). Les
 *      deux grilles les annonçaient à 25 dh : le coût d'achat ne change pas.
 *  10. (07/10/2026) Oujda et Taounate n'ont plus qu'une ligne chacune, sous
 *      leur nom usuel. La ligne de la grille (« Oujda (Centre & Quartiers) »
 *      chez EST, « taounate centre » chez Meta) doublait la ville
 *      d'implantation que scripts/ajouter-villes-agences.ts crée pour l'agence :
 *      même transporteur, même prix, même ville chez lui. Elle est fusionnée
 *      dans « Oujda » / « Taounate ». Les deux graphies restent reconnues
 *      (VILLES_EQUIVALENTES, lib/hub-envoi.ts) et la remise ne change pas :
 *      « Oujda » part chez EST sous « OUJDA », « Taounate » chez Meta sous #577.
 *
 * POURQUOI UN SCRIPT À PART DES IMPORTS. `scripts/import-prestataire-*.ts`
 * transcrivent les grilles reçues à la lettre (cf. scripts/auditer-conformite-
 * sources.ts) ; une décision prise après coup se tient à part pour rester
 * visible, comme scripts/ajouter-villes-agences.ts. C'est aussi la dernière
 * étape de scripts/charger-referentiel.ts : une base reconstruite retrouve ces
 * décisions au lieu de les perdre.
 *
 * GARDE-FOUS.
 *   · Idempotent : ce qui est déjà fait est signalé et sauté.
 *   · Une ville qui porte encore des colis et n'a pas de ville d'accueil n'est
 *     JAMAIS supprimée (la suppression mettrait leur ville à null) : elle est
 *     signalée, et rien n'est écrit tant qu'elle n'est pas réglée à la main.
 *   · Le retrait d'une ville du Hub Casablanca efface les TARIFS LIVREUR de
 *     cette ville (contrainte de clé étrangère). Or la paie d'une tournée lit
 *     ces tarifs à la clôture (§ getTarifsLivreur, lib/bon-distribution.ts) :
 *     un colis de Casablanca dans une tournée encore ouverte serait payé au
 *     tarif par défaut du livreur. Le script refuse donc tant qu'une telle
 *     tournée existe, sauf --forcer.
 *   · Tout s'applique dans UNE transaction : un échec n'écrit rien.
 */

// Le hub central (ex-« Hub Casablanca », renommé au passage en 11 hubs).
const HUB_INTERNE = HUB_CENTRAL;
const AGENCE_POWER_CASA = 'Agence Casablanca';

const RETRAITS = [
  { agence: 'Agence Marrakech', ville: 'moulay brahim' },
  { agence: 'Agence Casablanca', ville: 'SIDI HAJAJ' },
];

// `agenceVers` absente = même agence.
const FUSIONS: { agence: string; de: string; agenceVers?: string; vers: string }[] = [
  { agence: 'Agence El Jadida', de: 'l jadida', vers: 'El Jadida' },
  // Confiées à EST Livraison seul (05/10/2026).
  { agence: 'Agence Taza', de: 'TAOURIRT', agenceVers: 'Agence Oujda', vers: 'Taourirt' },
  { agence: 'Agence Taza', de: 'TAHLA', agenceVers: 'Agence Oujda', vers: 'Tahla' },
  { agence: 'Agence Taza', de: 'bouhlou', agenceVers: 'Agence Oujda', vers: 'Bouhlou' },
  { agence: 'Agence Taza', de: 'AKNOUL', agenceVers: 'Agence Oujda', vers: 'Aknoul' },
  { agence: 'Agence Taza', de: 'AJDIR TAZA', agenceVers: 'Agence Oujda', vers: 'Ajdir-Taza' },
  { agence: 'Agence Taza', de: 'OUAD AMLIL', agenceVers: 'Agence Oujda', vers: 'Oued Amlil' },
  // Confiées à EST Livraison seul (07/10/2026).
  { agence: 'Agence Taza', de: 'TAZA', agenceVers: 'Agence Oujda', vers: 'Taza Ville' },
  { agence: 'Agence Taza', de: 'GUERCIF', agenceVers: 'Agence Oujda', vers: 'Guercif Ville' },
  // Une seule ligne par ville d'implantation, sous son nom usuel (07/10/2026).
  { agence: 'Agence Oujda', de: 'Oujda (Centre & Quartiers)', vers: 'Oujda' },
  { agence: 'Agence Taounate', de: 'taounate centre', vers: 'Taounate' },
  // Laissées à Sahario Express seul (05/10/2026).
  { agence: 'Agence Agadir', de: 'sidi fini', agenceVers: 'Agence Guelmim', vers: 'Sidi ifni' },
  { agence: 'Agence Agadir', de: 'merleft', agenceVers: 'Agence Guelmim', vers: 'Mirleft' },
  // Laissées à Meta Livraison seul (05/10/2026).
  { agence: 'Agence Errachidia', de: 'Missour', agenceVers: 'Agence Missour', vers: 'missour' },
  { agence: 'Agence Errachidia', de: 'Bouleman', agenceVers: 'Agence Boulmane', vers: 'Boulmane' },
  { agence: 'Agence Errachidia', de: 'Guigou', agenceVers: 'Agence Boulmane', vers: 'guigo' },
  { agence: 'Agence Errachidia', de: 'Timahdite', agenceVers: 'Agence Boulmane', vers: 'timahdit' },
  { agence: 'Agence Errachidia', de: 'Outat Lhaj', agenceVers: 'Agence Missour', vers: 'outat el haj' },
];

const TARIFS = [
  { prestataire: 'Power Delivery', agence: 'Agence El Jadida', ville: 'El Jadida', livraison: 20, retour: null },
  { prestataire: 'EST Livraison', agence: 'Agence Oujda', ville: 'Oujda', livraison: 15, retour: 0 },
];

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

class Blocage extends Error {}

async function villeDe(tx: Tx, agence: string, nom: string) {
  const villes = await tx.ville.findMany({ where: { hub: { nom: nomHubActuel(agence) } }, select: { id: true, nom: true } });
  return villes.find((v) => normaliserVille(v.nom) === normaliserVille(nom)) ?? null;
}

async function nbColis(tx: Tx, villeId: string) {
  return tx.commande.count({ where: { villeId } });
}

// Rattache les colis d'une ville à une autre, puis supprime la première (ses
// tarifs prestataire partent en cascade, ses tarifs livreur explicitement).
async function deplacerPuisSupprimer(tx: Tx, de: { id: string; nom: string }, vers: { id: string } | null, lignes: string[]) {
  const colis = await nbColis(tx, de.id);
  if (colis > 0 && !vers) {
    throw new Blocage(`« ${de.nom} » porte ${colis} colis et n'a pas de ville d'accueil : à régler à la main avant de relancer`);
  }
  if (colis > 0 && vers) {
    await tx.commande.updateMany({ where: { villeId: de.id }, data: { villeId: vers.id } });
  }
  const tarifsLivreur = await tx.tarifLivreurVille.deleteMany({ where: { villeId: de.id } });
  await tx.ville.delete({ where: { id: de.id } });
  lignes.push(
    `« ${de.nom} » supprimée` +
      (colis ? ` — ${colis} colis rattaché(s) à la ville d'accueil` : '') +
      (tarifsLivreur.count ? ` — ${tarifsLivreur.count} tarif(s) livreur supprimé(s)` : '')
  );
}

async function appliquer(tx: Tx, forcer: boolean): Promise<string[]> {
  const lignes: string[] = [];

  // 1. Casablanca → Power.
  const internes = await tx.ville.findMany({ where: { hub: { nom: HUB_INTERNE } }, select: { id: true, nom: true } });
  if (internes.length === 0) {
    lignes.push(`${HUB_INTERNE} : aucune ville, déjà fait`);
  } else {
    const ouverts = await tx.commande.count({
      where: {
        villeId: { in: internes.map((v) => v.id) },
        bonDistribution: { statut: { not: 'cloture' } },
      },
    });
    if (ouverts > 0 && !forcer) {
      throw new Blocage(
        `${ouverts} colis de ${HUB_INTERNE} sont dans une tournée interne non clôturée : clôturer ces tournées, ` +
          `ou relancer avec --forcer (ils seraient payés au tarif par défaut du livreur)`
      );
    }
    lignes.push(`${HUB_INTERNE} → ${AGENCE_POWER_CASA} (${internes.length} ville(s))`);
    for (const v of internes) {
      await deplacerPuisSupprimer(tx, v, await villeDe(tx, AGENCE_POWER_CASA, v.nom), lignes);
    }
  }

  // 2. Retraits de la grille Power.
  for (const r of RETRAITS) {
    const v = await villeDe(tx, r.agence, r.ville);
    if (!v) lignes.push(`${r.agence} / « ${r.ville} » : absente, déjà fait`);
    else await deplacerPuisSupprimer(tx, v, null, lignes);
  }

  // 3. Fusions.
  for (const f of FUSIONS) {
    const de = await villeDe(tx, f.agence, f.de);
    const agenceVers = f.agenceVers ?? f.agence;
    const vers = await villeDe(tx, agenceVers, f.vers);
    if (!de) lignes.push(`${f.agence} / « ${f.de} » : absente, déjà fait`);
    else if (!vers) throw new Blocage(`${agenceVers} / « ${f.vers} » introuvable : impossible d'y rattacher les colis de « ${f.de} »`);
    else await deplacerPuisSupprimer(tx, de, vers, lignes);
  }

  // 4. Tarifs.
  for (const t of TARIFS) {
    const prestataire = await tx.prestataire.findUnique({ where: { nom: t.prestataire }, select: { id: true } });
    const v = await villeDe(tx, t.agence, t.ville);
    if (!prestataire || !v) throw new Blocage(`${t.prestataire} / ${t.agence} / « ${t.ville} » introuvable`);
    await tx.tarifPrestataireVille.upsert({
      where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: v.id } },
      update: { tarifLivraison: t.livraison, tarifRetour: t.retour },
      create: { prestataireId: prestataire.id, villeId: v.id, tarifLivraison: t.livraison, tarifRetour: t.retour },
    });
    lignes.push(`${t.prestataire} / « ${v.nom} » : ${t.livraison} dh${t.retour !== null ? `, retour ${t.retour} dh` : ''}`);
  }

  // 5. Retour à 0 dh partout (fait après les tarifs : couvre aussi ceux qu'on vient de poser).
  const retours = await tx.tarifPrestataireVille.updateMany({
    where: { OR: [{ tarifRetour: null }, { tarifRetour: { not: 0 } }] },
    data: { tarifRetour: 0 },
  });
  lignes.push(
    retours.count ? `Tarif de retour mis à 0 dh : ${retours.count} ville(s)` : 'Tarifs de retour : tous à 0 dh, déjà fait'
  );

  return lignes;
}

// À blanc, la même transaction est exécutée puis ANNULÉE : le rapport est donc
// exactement celui d'une vraie exécution, blocages compris.
class Simulation extends Error {
  constructor(readonly lignes: string[]) {
    super('simulation');
  }
}

export async function appliquerDecisionsVilles(options: { simulation?: boolean; forcer?: boolean } = {}): Promise<void> {
  const { simulation = false, forcer = false } = options;
  let lignes: string[];
  try {
    lignes = await prisma.$transaction(
      async (tx) => {
        const resultat = await appliquer(tx, forcer);
        if (simulation) throw new Simulation(resultat);
        return resultat;
      },
      { timeout: 60_000 }
    );
  } catch (e) {
    if (e instanceof Simulation) {
      console.log('À BLANC — rien n’a été écrit. Relancer avec --oui pour appliquer.\n');
      for (const l of e.lignes) console.log(`   ${l}`);
      return;
    }
    if (e instanceof Blocage) {
      console.log(`✘ Rien n'a été écrit : ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  console.log('Décisions appliquées :\n');
  for (const l of lignes) console.log(`   ${l}`);
}

if (lanceDirectement('decisions-villes-octobre-2026')) {
  lancerEnCli(() =>
    appliquerDecisionsVilles({
      simulation: !process.argv.includes('--oui'),
      forcer: process.argv.includes('--forcer'),
    })
  );
}
