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
 *  11. (08/10/2026) 46 villes connues de l'API Power Delivery et absentes du
 *      référentiel sont AJOUTÉES, chacune dans le hub du transporteur choisi
 *      par le product owner (page « Villes à confier »). SANS TARIF pour
 *      l'instant : le prix d'achat sera posé quand le transporteur l'aura
 *      donné. Nom retenu : celui de la grille de facturation quand elle cite
 *      la ville, sinon celui de l'API Power. Power ayant cinq hubs, ses villes
 *      sont rangées par province : Mohammedia et Ain Harrouda au Hub
 *      Casablanca, les sept autres (Kénitra, Sidi Kacem, Benslimane,
 *      Skhirate-Témara) au Hub Rabat.
 *      Garde-fou : une ville dont le nom existe déjà dans un AUTRE hub n'est
 *      pas créée (le routage les confondrait et enverrait les colis chez le
 *      moins cher des deux).
 *  12. (09/10/2026) « azrou » (Hub Fès, Meta) devient « Azrou (Ifrane) » :
 *      depuis l'ajout d'« Azrou-agadir », deux Azrou sont desservies et la
 *      liste des villes doit dire laquelle est laquelle. Sa correspondance
 *      Meta suit (lib/meta-livraison-villes.ts) : la remise reste #192.
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
  // (09/10/2026) Ajoutée la veille au point 11, finalement retirée.
  { agence: 'Hub Agadir', ville: 'Tata' },
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

// Point 12 (09/10/2026) : deux Azrou desservies — celle d'Ifrane (Meta) et
// celle d'Agadir (Leader, « Azrou-agadir »). La première, transcrite « azrou »,
// prend un nom qui dit laquelle c'est dans la liste déroulante des villes.
export const RENOMMAGES = [{ hub: 'Hub Fès', de: 'azrou', vers: 'Azrou (Ifrane)' }];

// Point 11 : villes de l'API Power absentes du référentiel, confiées par le
// product owner le 08/10/2026. Créées sans tarif. Écartées par lui (« Ne pas
// ajouter ») : Ait ouqabli, AIT TALEB, limouna, OULAD BOUBKER, OUM AZZA,
// Tagelft, Tilouguite.
export const AJOUTS: { hub: string; villes: string[] }[] = [
  {
    hub: 'Hub Fès', // Meta Livraison
    villes: [
      'Ain-Cheggag', 'Ain chkaf', 'Ain Taoujdate', 'Dayet Aoua', 'Imouzzer du Kandar', 'Kariat Ba Mohamed',
      "M'haya", 'Ouislane', 'Oulad Tayeb', 'Sidi Kacem', 'Sidi Slimane', 'Sidi Yahya El Gharb',
    ],
  },
  {
    hub: 'Hub Béni Mellal', // Colivraison
    villes: ['El Gara', 'Guisser', 'Had Boumoussa', 'Lakhlalta', 'LKHORBA', 'MFASSIS', 'OULED ABDOUN', 'Wawla'],
  },
  { hub: 'Hub Oujda', villes: ['Beni Chiker', 'Debdo', 'SIDI YAHYA OUJDA'] }, // EST Livraison
  {
    hub: 'Hub Agadir', // Leader Colis
    // Tata, ajoutée le 08/10, retirée le 09/10 (décision de l'exploitation) : voir RETRAITS.
    villes: ['Azrou-agadir', 'Chtouka ait baha', 'Oulad Teima', 'TAMGHART', 'Taroudant', 'Temsia', 'Tiznit'],
  },
  { hub: 'Hub Tanger', villes: ['AOUAMA', 'Cabo Negro', 'Chaoune', 'DALIA', 'Jorf El Melha'] }, // Amir Livraison
  { hub: 'Hub Guelmim', villes: ['Marsa - laayoun'] }, // Sahario Express
  { hub: 'Hub Casablanca', villes: ['Ain Harrouda', 'Mohammedia'] }, // Power Delivery
  {
    hub: 'Hub Rabat', // Power Delivery
    villes: [
      'El Mansouria', 'Khenichet', 'Lalla Mimouna', 'Mechra Bel Ksiri', 'Moulay Bousselham', 'Sidi Yahya Zaïr',
      'Souk El Arbaa Du Gharb',
    ],
  },
];

// Tarifs posés sur des villes du point 11 (08/10/2026). Taroudant, Tiznit et
// Oulad Teima : 23 dh, le prix de la zone que la grille Leader rangeait sous
// leur nom. Retour 0 dh comme partout (point 8).
// (09/10/2026) Les 12 villes confiées à Meta Livraison : 25 dh, le prix de la
// quasi-totalité de leur grille.
export const TARIFS_AJOUTS = [
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Taroudant', livraison: 23 },
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Tiznit', livraison: 23 },
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Oulad Teima', livraison: 23 },
  ...(AJOUTS.find((a) => a.hub === 'Hub Fès')?.villes ?? []).map((ville) => ({
    prestataire: 'Meta Livraison', hub: 'Hub Fès', ville, livraison: 25,
  })),
  // (09/10/2026) Power Delivery, saisis par le product owner (page « Tarifs manquants »).
  { prestataire: 'Power Delivery', hub: 'Hub Casablanca', ville: 'Ain Harrouda', livraison: 25 },
  { prestataire: 'Power Delivery', hub: 'Hub Casablanca', ville: 'Mohammedia', livraison: 23 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'El Mansouria', livraison: 30 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Khenichet', livraison: 35 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Lalla Mimouna', livraison: 35 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Mechra Bel Ksiri', livraison: 35 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Moulay Bousselham', livraison: 35 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Sidi Yahya Zaïr', livraison: 30 },
  { prestataire: 'Power Delivery', hub: 'Hub Rabat', ville: 'Souk El Arbaa Du Gharb', livraison: 35 },
  // (09/10/2026) Leader Colis, même source.
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Azrou-agadir', livraison: 15 },
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Chtouka ait baha', livraison: 23 },
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'TAMGHART', livraison: 23 },
  { prestataire: 'Leader Colis', hub: 'Hub Agadir', ville: 'Temsia', livraison: 20 },
  // (09/10/2026) Sahario Express, donné par l'exploitation.
  { prestataire: 'Sahario Express', hub: 'Hub Guelmim', ville: 'Marsa - laayoun', livraison: 25 },
  // (09/10/2026) Les villes restées sans tarif : 35 dh, décision de l'exploitation.
  ...(
    [
      ['Hub Béni Mellal', 'Colivraison'],
      ['Hub Oujda', 'EST Livraison'],
      ['Hub Tanger', 'Amir Livraison'],
    ] as const
  ).flatMap(([hub, prestataire]) =>
    (AJOUTS.find((a) => a.hub === hub)?.villes ?? []).map((ville) => ({ prestataire, hub, ville, livraison: 35 }))
  ),
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

  // 6. Renommages (point 12).
  for (const r of RENOMMAGES) {
    const de = await villeDe(tx, r.hub, r.de);
    const vers = await villeDe(tx, r.hub, r.vers);
    if (!de && vers) {
      lignes.push(`${r.hub} / « ${r.vers} » : déjà renommée`);
      continue;
    }
    if (vers) throw new Blocage(`${r.hub} / « ${r.vers} » existe déjà à côté de « ${r.de} » : à trancher à la main`);
    if (!de) throw new Blocage(`${r.hub} / « ${r.de} » introuvable : impossible de la renommer`);
    await tx.ville.update({ where: { id: de.id }, data: { nom: r.vers } });
    lignes.push(`${r.hub} / « ${de.nom} » renommée « ${r.vers} »`);
  }

  // 7. Villes de l'API Power ajoutées sans tarif (point 11).
  const existantes = await tx.ville.findMany({ select: { nom: true, hub: { select: { nom: true } } } });
  const parNom = new Map(existantes.map((v) => [normaliserVille(v.nom), v]));
  let ajoutees = 0;
  for (const a of AJOUTS) {
    const hub = await tx.hub.findUnique({ where: { nom: a.hub }, select: { id: true } });
    if (!hub) throw new Blocage(`${a.hub} introuvable`);
    for (const nom of a.villes) {
      const deja = parNom.get(normaliserVille(nom));
      if (deja && deja.hub.nom === a.hub) continue;
      if (deja) throw new Blocage(`« ${nom} » existe déjà au ${deja.hub.nom} (« ${deja.nom} ») : à trancher avant de l'ajouter au ${a.hub}`);
      await tx.ville.create({ data: { nom, hubId: hub.id } });
      parNom.set(normaliserVille(nom), { nom, hub: { nom: a.hub } });
      ajoutees++;
    }
  }
  const total = AJOUTS.reduce((n, a) => n + a.villes.length, 0);
  lignes.push(ajoutees ? `Villes de l'API Power ajoutées sans tarif : ${ajoutees} / ${total}` : `Villes de l'API Power : les ${total} existent, déjà fait`);

  for (const t of TARIFS_AJOUTS) {
    const prestataire = await tx.prestataire.findUnique({ where: { nom: t.prestataire }, select: { id: true } });
    const v = await villeDe(tx, t.hub, t.ville);
    if (!prestataire || !v) throw new Blocage(`${t.prestataire} / ${t.hub} / « ${t.ville} » introuvable`);
    await tx.tarifPrestataireVille.upsert({
      where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: v.id } },
      update: { tarifLivraison: t.livraison, tarifRetour: 0 },
      create: { prestataireId: prestataire.id, villeId: v.id, tarifLivraison: t.livraison, tarifRetour: 0 },
    });
    lignes.push(`${t.prestataire} / « ${v.nom} » : ${t.livraison} dh, retour 0 dh`);
  }

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
