import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import du réseau Colivraison (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-prestataire-colivraison.ts`.
 *
 * Couvre deux régions qu'aucun autre réseau ne desservait : Béni Mellal-Khénifra
 * (grille « coliv.pdf », agences Béni Mellal, Khouribga, Khénifra, Azilal) et
 * Drâa-Tafilalet (« ZONE DARAA TAFILLAT.csv », agences Errachidia et
 * Ouarzazate). Idempotent et non destructif, comme les autres imports.
 *
 * Les deux fichiers donnent aussi les jours de passage (« CHAQUE JOUR »,
 * « MARDI-JEUDI-SAMEDI », « 48H »…) et, pour Drâa-Tafilalet, une colonne
 * « PLUS 1 JOUR ». Le schéma n'a pas de champ pour ces délais : ils ne sont pas
 * importés. Aucun tarif de retour non plus, aucun des deux fichiers n'en donne.
 *
 * Les noms sont repris tels que la grille les écrit, sans la partie arabe.
 */

const PRESTATAIRE = 'Colivraison';

type Zone = { tarif: number; villes: string[] };
type AgenceImport = { hub: string; ville: string; zones: Zone[] };

export const AGENCES: AgenceImport[] = [
  {
    hub: 'Agence Béni Mellal',
    ville: 'Beni Mellal',
    zones: [
      { tarif: 18, villes: ['Beni Mellal'] },
      {
        tarif: 25,
        villes: [
          'Riad Salam',
          'Ait Tislit',
          'Mghila',
          'Ain-Elghazi Ali',
          'Tifrit',
          'Aourir BM',
          'Oulad Moussa',
          'Souk Sebt Ouled Nemma',
          'Fkih Ben Salah',
          'Kasba Tadla',
          'Oulad Mrah',
          'Sidi Aissa Ben Ali',
          'Foum Oudi',
          'Oulad Mbarek',
          'Timoulilte',
          'Dar Oulad Zidouh',
          'Laayayta-Oulad Gnaou',
          'Afourar',
          'Beni Ayat',
          'Laajana',
          'Sidi Jaber',
          'Oulad Ali Loued',
          'Had Lbradia',
          'Oulad Zmam',
          'Oulad Ayad Souk Sebt',
          'La Zone Industrielle (BM)',
          'Lakraza Ouled Said',
          'Zaouiat Cheikh',
          'El Ksiba',
          'Ighrem Laalam',
          'Faryata',
          'Oulad Yaich',
          'Adouz',
          'Tagzert',
          'Ikhoureba',
          'Zouair',
          'Foum Zaouia',
          'Tanougha',
          'Foum El Anser',
          'Ouled Driss',
          'Ahl Merbaa',
          'Ahl Souss',
          'Lahlalma',
          'Ouled Rguiaa',
          'Harboulia',
          'Oulad Drid',
          'El Bazzaza',
          'Oulad Youssef',
          'Oulad Said Louad',
        ],
      },
    ],
  },
  {
    hub: 'Agence Khouribga',
    ville: 'Khouribga',
    zones: [
      {
        tarif: 25,
        villes: [
          'Khouribga',
          'Boulanouare',
          'Bejaad',
          'Oued Zem',
          'Tachrafat',
          'Ain Kaicher',
          'Bir Mezoui',
          'Boujniba',
          'Lagfaf',
          'Hattane',
        ],
      },
    ],
  },
  {
    hub: 'Agence Khénifra',
    ville: 'Khenifra',
    zones: [
      {
        tarif: 25,
        villes: [
          'Khenifra',
          'Mrirt',
          'Aguelmouss',
          'El Kbab',
          'Tighasaline',
          'El Borj',
          'Ait Ishaq',
          'Lahri',
          'Moulay Bouaza',
          'Had Bouhsousen',
          'Kahf Nssoure',
          'Ouaoumana',
          'Aghbalou',
        ],
      },
    ],
  },
  {
    hub: 'Agence Azilal',
    ville: 'Azilal',
    zones: [
      { tarif: 25, villes: ['Azilal', 'Ouzoud', 'Tanant', 'Foum Jamaa', 'Bin El Ouidane'] },
      {
        tarif: 30,
        villes: ['Aghbala', 'Tizi Nisly', 'Ait Attab', 'Ouaouizeght', 'Oulad Remich', 'Boukaroune', 'Ouad Laabid', 'Bzou'],
      },
    ],
  },
  {
    hub: 'Agence Errachidia',
    ville: 'Errachidia',
    zones: [
      { tarif: 25, villes: ['Errachidia'] },
      {
        tarif: 30,
        villes: [
          'Midelt',
          'Tinejdad',
          'Goulmima',
          'Arfoud',
          'Er-rich',
          'Aoufous',
          'Missour',
          'Bouleman',
          'Guigou',
          'Timahdite',
          'Outat Lhaj',
          'Alnif',
          'Merzouga',
          'Rissani',
          'Boumia',
          'Zaida',
          'Itzer',
          'Aghbalou nserdan',
          'Boudnib',
          'El jorf',
        ],
      },
    ],
  },
  {
    hub: 'Agence Ouarzazate',
    ville: 'Ouarzazate',
    zones: [
      { tarif: 25, villes: ['Ouarzazate'] },
      {
        tarif: 30,
        villes: [
          'Tinghir',
          'Kelaat magouna',
          'Zagora',
          'Tabounte',
          'Tarmigt',
          'Boumalne Dades',
          'Agdz',
          'Skoura',
          'Idelsane',
          'Taznakht',
          'Agouim',
          'Tazarine',
          'Nkoub',
          'Tinzouline',
          'Amerzgane',
          'Ait zineb-oarz',
          'Timadline',
          'Ait Ben Haddou',
          'Taghbalte-ouarz',
          'Ighrem nougdal',
          'Tamegroute',
          'Toundoute',
          'Tagounite',
          'Mhamid ghizlane',
        ],
      },
    ],
  },
];

export async function importerColivraison(): Promise<void> {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE },
    update: {},
    create: { nom: PRESTATAIRE },
  });
  console.log(`Prestataire : ${prestataire.nom} (${prestataire.id})`);

  let creees = 0;
  let tarifs = 0;

  for (const agence of AGENCES) {
    const hub = await resoudreHubImport({
      prestataireId: prestataire.id,
      ville: agence.ville,
      nom: agence.hub,
    });

    const total = agence.zones.reduce((t, z) => t + z.villes.length, 0);
    console.log(`\n${hub.nom} — ${total} villes`);
    if (hub.renommeDepuis) console.log(`   Hub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);

    for (const zone of agence.zones) {
      for (const nom of zone.villes) {
        const ville = await resoudreVilleImport(hub.id, nom);
        if (ville.cree) creees += 1;
        if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);

        await prisma.tarifPrestataireVille.upsert({
          where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: ville.id } },
          update: { tarifLivraison: zone.tarif },
          create: { prestataireId: prestataire.id, villeId: ville.id, tarifLivraison: zone.tarif },
        });
        tarifs += 1;
      }
      console.log(`   zone ${zone.tarif} dh : ${zone.villes.length} villes`);
    }
  }

  console.log(`\nTerminé — ${creees} villes créées, ${tarifs} tarifs ${prestataire.nom} en base.`);
  console.log("Aucun tarif de retour : les fichiers sources n'en donnent pas.");
}

if (lanceDirectement('import-prestataire-colivraison')) {
  lancerEnCli(importerColivraison);
}
