import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import du réseau Sahario Express (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-prestataire-sahario-express.ts`.
 *
 * Troisième réseau sous-traité, après Power Delivery (Centre) et Meta Livraison
 * (Nord-Est) : celui-ci couvre le Sud et le Souss. Idempotent et non
 * destructif, comme les deux autres.
 *
 * L'Agence Agadir est tarifée par ZONE (15 / 20 / 23 dh) et non ville par
 * ville : la structure du fichier source est conservée ci-dessous, chaque zone
 * portant son prix une seule fois. L'Agence Guelmim, elle, donne un prix par
 * ligne.
 *
 * À l'intérieur de la zone 23, « Taroudant : », « Tiznit : » et
 * « Oulad teima : » introduisaient leurs localités. Les trois chefs-lieux sont
 * eux-mêmes créés au tarif de la zone : ils font partie de la liste qu'ils
 * ouvrent, et couvrir Oulad Berhil ou Aglou sans couvrir Taroudant ou Tiznit
 * n'aurait pas de sens opérationnel.
 */

const PRESTATAIRE = 'Sahario Express';

type Zone = { tarif: number; villes: string[] };
type AgenceImport = { hub: string; ville: string; zones: Zone[] };

const AGENCES: AgenceImport[] = [
  {
    hub: 'Agence Guelmim',
    ville: 'Guelmim',
    zones: [
      { tarif: 15, villes: ['Guelmim'] },
      {
        tarif: 25,
        villes: [
          'Bouizakarn',
          // « Sidi ifni » et « Mirleft » sont maintenues ici À CÔTÉ de
          // « sidi fini » et « merleft », rattachées à l'Agence Agadir en zone
          // 23 : le donneur d'ordre a confirmé les deux listes telles quelles.
          // Ce sont donc quatre villes distinctes pour le système, pas deux
          // orthographes.
          'Sidi ifni',
          'Mirleft',
          'Assa',
          'Zag',
          'Tantan',
          'El ouatia',
          'Tarfaya',
          'Laayoune',
          'Laayoune porte',
          'Es semara',
          'Boujdour',
          'Dakhla',
        ],
      },
    ],
  },
  {
    hub: 'Agence Agadir',
    ville: 'Agadir',
    zones: [
      // « ait mlloul » est la graphie du message. Une version antérieure la
      // corrigeait en « Ait Melloul » : une grille fournisseur se recopie, elle
      // ne se corrige pas.
      { tarif: 15, villes: ['Agadir', 'dchaira', 'inzgane', 'ait mlloul'] },
      {
        tarif: 20,
        villes: [
          'Sidi bibi',
          'Anza',
          'Aourir',
          'Biougra',
          'Ait aamira',
          'Tadart anza',
          'Tamraght',
          'Tarast',
          'Drarga',
          'Tikiwine',
          'Leqliaa',
          'tamait',
        ],
      },
      {
        tarif: 23,
        villes: [
          // Les messages écrivent « . Taroudant : », « . Tiznit : » et
          // « . Oulad teima : » en EN-TÊTES de groupe — un point devant, deux
          // points derrière — suivis de leurs localités. Ce sont des repères de
          // lecture, pas des destinations : les trois chefs-lieux ne sont donc
          // PAS créés. Une version antérieure en faisait des villes livrables à
          // 23 DH, ce qui ajoutait trois destinations que le fournisseur n'a
          // jamais annoncées.
          //
          // Secteur Taroudant
          'Zaouiat',
          'iferkane',
          'Ait aiaaza',
          'El nouwayle',
          'Oulad aarfa',
          'taliwin',
          'awlouz',
          'oulad berhil',
          // Secteur Tiznit
          'Anzi',
          'tighmi',
          'idawsmlal',
          'tafraout',
          'ait jraj',
          'lakhssas',
          'bounaiman',
          'sihll',
          'merleft',
          'sidi fini',
          'aglou',
          'lmaader',
          'rasmouka',
          'wijan',
          // Secteur Oulad Teima
          // Orthographe du message. Elle portait une précision « (Oulad Teima) »
          // tant que `Ville.nom` était unique pour tout le réseau, pour ne pas
          // entrer en collision avec la Sidi Moussa de Marrakech ; l'unicité
          // par hub (§ @@unique([hubId, nom])) rend cette béquille inutile.
          'Sidi moussa',
          'lhamri',
          'Sebt el guerdane',
          'Douar sulad',
          'said Qrarma',
          'Lakhnafif',
          'El koudia',
          'Lagfifat',
          'Ain seddaq',
          'Belfaa',
          'massa',
          'taghazout',
          'imi wadar',
        ],
      },
    ],
  },
];

async function main() {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE },
    update: {},
    create: { nom: PRESTATAIRE },
  });
  console.log(`Prestataire : ${prestataire.nom} (${prestataire.id})`);

  let creees = 0;
  let tarifs = 0;
  const conflits: string[] = [];

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
        // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville) :
        // une ville homonyme chez un autre réseau n'est plus un conflit, c'est
        // une seconde offre sur la même ville. La graphie du message fait foi.
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
  console.log("Aucun tarif de retour : le fichier source n'en donne pas.");
  if (conflits.length > 0) {
    console.log('\nCONFLITS À ARBITRER :');
    for (const c of conflits) console.log(`   ${c}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
