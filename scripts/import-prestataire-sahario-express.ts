import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import du réseau Sahario Express (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-prestataire-sahario-express.ts`.
 *
 * Troisième réseau sous-traité, après Power Delivery (Centre) et Meta Livraison
 * (Nord-Est) : celui-ci couvre le Sud, de Guelmim aux provinces sahariennes.
 * Idempotent et non destructif, comme les deux autres.
 *
 * UNE SEULE AGENCE, ET C'EST UNE CORRECTION. Ce fichier a longtemps porté
 * l'Agence Agadir et ses 51 villes du Souss. Elles relèvent en réalité de
 * LEADER COLIS et vivent désormais dans
 * `scripts/import-prestataire-leader-colis.ts` (corrigé le 23 septembre 2026,
 * § SOUS_TRAITANCE.md §2.11). Sahario ne dessert que Guelmim.
 *
 * L'Agence Guelmim donne un prix par ligne, et non par zone comme la grille
 * d'Agadir : les deux tarifs — 15 dh sur Guelmim même, 25 dh partout ailleurs —
 * sont exprimés ci-dessous comme le fait le message source.
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
          // « sidi fini » et « merleft », que l'Agence Agadir de LEADER COLIS
          // dessert en zone 23 : le donneur d'ordre a confirmé les deux listes
          // telles quelles. Ce sont donc quatre villes distinctes pour le
          // système, pas deux orthographes — et, depuis la correction
          // d'attribution, quatre villes réparties sur DEUX réseaux : la
          // graphie saisie par le marchand décide du prestataire, donc du coût.
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
];

export async function importerSaharioExpress(): Promise<void> {
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
}

if (lanceDirectement('import-prestataire-sahario-express')) {
  lancerEnCli(importerSaharioExpress);
}
