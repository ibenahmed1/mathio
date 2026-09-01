import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport } from '../lib/prestataires';

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
          // Sidi Ifni et Mirleft sont maintenues ici À CÔTÉ de « Sidi Fini » et
          // « Merleft », rattachées à l'Agence Agadir en zone 23 : le donneur
          // d'ordre a confirmé les deux listes telles quelles. Ce sont donc
          // quatre villes distinctes pour le système, pas deux orthographes.
          'Sidi Ifni',
          'Mirleft',
          'Assa',
          'Zag',
          'Tantan',
          'El Ouatia',
          'Tarfaya',
          'Laayoune',
          'Laayoune Porte',
          'Es Semara',
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
      { tarif: 15, villes: ['Agadir', 'Dchaira', 'Inzgane', 'Ait Melloul'] },
      {
        tarif: 20,
        villes: [
          'Sidi Bibi',
          'Anza',
          'Aourir',
          'Biougra',
          'Ait Aamira',
          'Tadart Anza',
          'Tamraght',
          'Tarast',
          'Drarga',
          'Tikiwine',
          'Leqliaa',
          'Tamait',
        ],
      },
      {
        tarif: 23,
        villes: [
          // Secteur Taroudant
          'Taroudant',
          'Zaouiat',
          'Iferkane',
          'Ait Aiaaza',
          'El Nouwayle',
          'Oulad Aarfa',
          'Taliwin',
          'Awlouz',
          'Oulad Berhil',
          // Secteur Tiznit
          'Tiznit',
          'Anzi',
          'Tighmi',
          'Idawsmlal',
          'Tafraout',
          'Ait Jraj',
          'Lakhssas',
          'Bounaiman',
          'Sihll',
          'Merleft',
          'Sidi Fini',
          'Aglou',
          'Lmaader',
          'Rasmouka',
          'Wijan',
          // Secteur Oulad Teima
          'Oulad Teima',
          // Orthographe du fichier. Elle portait une précision « (Oulad Teima) »
          // tant que `Ville.nom` était unique pour tout le réseau, pour ne pas
          // entrer en collision avec la Sidi Moussa de Marrakech ; l'unicité
          // par hub (§ @@unique([hubId, nom])) rend cette béquille inutile.
          'Sidi moussa',
          'Lhamri',
          'Sebt El Guerdane',
          'Douar Sulad',
          'Said Qrarma',
          'Lakhnafif',
          'El Koudia',
          'Lagfifat',
          'Ain Seddaq',
          'Belfaa',
          'Massa',
          'Taghazout',
          'Imi Wadar',
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

    for (const zone of agence.zones) {
      for (const nom of zone.villes) {
        // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville) :
        // une ville homonyme chez un autre réseau n'est plus un conflit, c'est
        // une seconde offre sur la même ville.
        const existante = await prisma.ville.findUnique({
          where: { hubId_nom: { hubId: hub.id, nom } },
        });

        const ville = existante ?? (await prisma.ville.create({ data: { nom, hubId: hub.id } }));
        if (!existante) creees += 1;

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
