import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import du réseau EST Livraison — Région de l'Oriental (§ /admin/hubs),
 * exécutable via `npx tsx scripts/import-prestataire-est-livraison.ts`.
 *
 * Cinquième réseau sous-traité. Deux particularités par rapport aux quatre
 * précédents :
 *
 *  1. PREMIER RÉSEAU AVEC UN TARIF DE RETOUR. La grille l'annonce à 0 DH
 *     partout (« 100 % GRATUIT »). Zéro est ici une VALEUR, pas une absence :
 *     un retour chez EST Livraison ne coûte rien, ce qui est très différent de
 *     « on ne sait pas ce qu'il coûte ». Les colis retournés dans ces villes
 *     auront donc, seuls de tout le référentiel, une marge exacte.
 *
 *  2. RECOUVREMENT ASSUMÉ AVEC META LIVRAISON. La « Province de Taza » de cette
 *     grille couvre dix villes déjà desservies par l'Agence Taza de Meta
 *     Livraison. Elles ne sont PAS déplacées — Meta les livre aujourd'hui — mais
 *     leur tarif EST Livraison est tout de même enregistré. C'est précisément ce
 *     que TarifPrestataireVille rend possible en s'indexant sur
 *     (prestataire, ville) et non sur l'agence : deux offres sur une même ville,
 *     `Ville.hubId` disant laquelle est active. Sans ça, comparer les deux
 *     réseaux sur Taza serait impossible.
 *
 * Une seule agence est créée, « Agence Oujda » : le document est une grille
 * unique pour un réseau unique, dont Oujda est la seule ville à tarif
 * préférentiel (15 DH, 24 h). Ses huit blocs sont des PROVINCES couvertes, pas
 * des agences physiques — en faire huit hubs reviendrait à inventer des quais
 * que la grille ne mentionne pas.
 */

const PRESTATAIRE = 'EST Livraison';
const HUB = 'Agence Oujda';
const VILLE_HUB = 'Oujda';

// Le retour est gratuit sur tout le réseau (bandeau « FRAIS DE RETOUR — 0 DH »).
const TARIF_RETOUR = 0;

type Zone = {
  province: string;
  tarif: number;
  villes: string[];
  // Délais annoncés par la grille. Non persistés : le modèle ne porte pas
  // encore de calendrier de desserte (même limite que le programme
  // hebdomadaire de Meta Livraison). Transcrits pour ne pas avoir à relire le
  // PDF le jour où on les modélisera. « Lun - Sam » quand rien n'est précisé.
  delais?: Record<string, string>;
};

// Les villes sont enregistrées AVEC L'ORTHOGRAPHE DE LA GRILLE — « Taza Ville »,
// « Oued Amlil », « Ajdir-Taza » — et non ramenées à celle d'un autre réseau.
//
// Une table d'alias faisait l'inverse à l'origine, pour éviter des doublons que
// `Ville.nom @unique` interdisait alors. Elle a été retirée avec la contrainte
// (§ @@unique([hubId, nom])) : ce que l'écran doit montrer d'un fournisseur,
// c'est SA grille, mot pour mot. Deux réseaux qui écrivent la même ville
// autrement ont chacun leur ligne, et la comparaison des deux offres se lit.
const ZONES: Zone[] = [
  {
    province: 'Oujda & périphérie',
    tarif: 15,
    villes: ['Oujda (Centre & Quartiers)'],
    delais: { 'Oujda (Centre & Quartiers)': 'Lun - Sam (24h)' },
  },
  {
    province: 'Oujda & périphérie',
    tarif: 25,
    villes: ['Beni Drar (Bnidrar)', 'Bni Oukil'],
  },
  {
    province: 'Province de Berkane',
    tarif: 25,
    villes: ['Berkane', 'Saidia', 'Ahfir', 'Aklim', 'Madagh', 'Fezouane', 'Cafimour', 'Lamriss', "Ras El Ma (Cap de l'Eau)"],
    delais: { "Ras El Ma (Cap de l'Eau)": 'Lun, Mer, Ven' },
  },
  {
    province: 'Grand Nador',
    tarif: 25,
    villes: [
      'Nador Ville',
      'Selouane',
      'El Aroui',
      'Bni Ansar',
      'Farkhana',
      'Zeghanghane',
      'Zaio',
      'Bouarg',
      'Ihdaden',
      'Kariat Arekmane',
    ],
    delais: { 'Kariat Arekmane': 'Lun et Jeu' },
  },
  {
    province: 'Province de Driouch',
    tarif: 25,
    villes: ['Driouch', 'Midar', 'Ben Tayeb', 'Kassita', 'Tafersit', 'Azlaf', 'Dar El Kebdani', 'Temsamane', 'Bodinar'],
    delais: {
      Tafersit: 'Lun, Mer, Ven',
      Azlaf: 'Lun, Mer, Ven',
      'Dar El Kebdani': 'Mar, Jeu, Sam',
      Temsamane: 'Lun et Jeu',
      Bodinar: 'Lun et Jeu',
    },
  },
  {
    province: "Province d'Al Hoceima",
    tarif: 25,
    villes: [
      'Al Hoceima Ville',
      'Imzouren',
      'Beni Bouayach',
      'Targuist',
      'Issaguen',
      'Ajdir',
      'Boukidaren',
      'Bni Hadifa',
      'Bni Boufrah',
    ],
    delais: { 'Bni Hadifa': '3x / semaine', 'Bni Boufrah': '3x / semaine' },
  },
  {
    province: 'Taourirt & Guercif',
    tarif: 25,
    villes: ['Taourirt', 'Layoun Charkia', 'Guercif Ville', 'Taddart'],
    delais: { Taddart: 'Mer et Sam' },
  },
  {
    province: 'Province de Taza',
    tarif: 25,
    villes: [
      'Taza Ville',
      'Tahla',
      'Oued Amlil',
      'Aknoul',
      'Tizi Ouzli',
      'Ajdir-Taza',
      'Gueldamane',
      'Bouhlou',
      'Had Oulad Zbair',
      'Had Msila',
    ],
  },
  {
    province: 'Jerada, Figuig & Sud Oriental',
    tarif: 25,
    villes: ['Jerada', 'Ain Bni Mathar', 'Guenfouda', 'Bouarfa', 'Tandrara', 'Figuig', 'Bni Tajjit', 'Bouanane', 'Talsint'],
    delais: { Bouanane: 'J+2', Talsint: 'J+2' },
  },
];

async function main() {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE },
    update: {},
    create: { nom: PRESTATAIRE },
  });

  const hub = await resoudreHubImport({ prestataireId: prestataire.id, ville: VILLE_HUB, nom: HUB });
  if (hub.renommeDepuis) console.log(`Hub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);
  console.log(`${hub.nom} — agence ${prestataire.nom}\n`);

  let creees = 0;
  let tarifs = 0;
  const partagees: string[] = [];

  for (const zone of ZONES) {
    for (const nom of zone.villes) {
      // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville).
      // Le contournement décrit en tête — poser le tarif d'EST sur la ligne de
      // Meta Livraison, faute de pouvoir créer la sienne — n'a plus lieu
      // d'être : EST possède maintenant sa propre couverture de la Province de
      // Taza, et les deux grilles se lisent chacune pour ce qu'elle est.
      const ville = await resoudreVilleImport(hub.id, nom);
      const villeId = ville.id;
      if (ville.cree) creees += 1;
      if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);

      // Villes que d'autres réseaux annoncent aussi : information, pas conflit.
      const ailleurs = await prisma.ville.findFirst({
        where: { nom, hubId: { not: hub.id } },
        select: { hub: { select: { nom: true, prestataire: { select: { nom: true } } } } },
      });
      if (ailleurs) {
        partagees.push(`${nom} — également desservie par ${ailleurs.hub.prestataire?.nom ?? ailleurs.hub.nom}`);
      }

      await prisma.tarifPrestataireVille.upsert({
        where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId } },
        update: { tarifLivraison: zone.tarif, tarifRetour: TARIF_RETOUR },
        create: { prestataireId: prestataire.id, villeId, tarifLivraison: zone.tarif, tarifRetour: TARIF_RETOUR },
      });
      tarifs += 1;
    }
    console.log(`   ${zone.province.padEnd(30)} ${String(zone.villes.length).padStart(2)} villes à ${zone.tarif} DH`);
  }

  console.log(`\nTerminé — ${creees} villes créées, ${tarifs} tarifs (retour à ${TARIF_RETOUR} DH sur tout le réseau).`);

  if (partagees.length > 0) {
    console.log(`\n${partagees.length} villes également desservies par un autre réseau :`);
    for (const p of partagees) console.log(`   ${p}`);
    console.log('   → offres comparables ; bascule = déplacer la ville vers cette agence dans /admin/hubs.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
