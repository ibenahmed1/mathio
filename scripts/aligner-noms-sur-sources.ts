import 'dotenv/config';
import { prisma } from '../lib/prisma';

/**
 * Rend aux villes la graphie de leur document d'origine —
 * `npx tsx scripts/aligner-noms-sur-sources.ts`.
 *
 * Ne traite QUE les écarts de CONTENU : lettres ajoutées, retirées ou
 * remplacées. La casse n'est pas touchée ici — c'est un autre chantier, ~250
 * renommages mécaniques, et le mélanger à celui-ci rendrait le rapport
 * illisible.
 *
 * Deux réseaux concernés, pour des raisons différentes :
 *
 *  META LIVRAISON — trois noms « corrigés » à l'import alors qu'ils ne
 *  demandaient rien. Le plus révélateur est « sidi 3llal lbahraoui kamoni » :
 *  le « 3 » de l'alphabet de discussion (ع) y avait été développé en « A »,
 *  alors qu'il a été conservé partout ailleurs — marzou9a, sabt bou9lal,
 *  lma3ziz, jm3at hodran, hjar ma3dan, ait ya3zem, lhaj 9adour, sidi 3edi.
 *  Une convention appliquée à un nom sur neuf n'est pas une convention.
 *
 *  SAHARIO EXPRESS — « ait mlloul » avait été corrigé en « Ait Melloul », et
 *  trois EN-TÊTES de groupe des messages WhatsApp (« . Taroudant : »,
 *  « . Tiznit : », « . Oulad teima : ») avaient été pris pour des villes
 *  desservies. L'Agence Agadir revient de 54 à 51 villes, ce que dit le
 *  message.
 *
 * SUPPRESSION SOUS CONDITION : une ville n'est retirée que si rien ne s'y
 * rattache — ni colis, ni tarif livreur, ni tarif marchand. Sinon elle est
 * conservée et le script le signale. Un référentiel se corrige, mais pas au
 * prix d'un historique. Le tarif prestataire tombe en cascade
 * (§ TarifPrestataireVille).
 */

const RENOMMAGES: { agence: string; de: string; vers: string; motif: string }[] = [
  // --- Power Delivery -----------------------------------------------------
  {
    agence: 'Agence Marrakech',
    de: 'Ras El Ain Rhamna',
    vers: 'ras elain erhamna',
    motif: 'lettres déplacées, pas seulement la casse',
  },
  {
    agence: 'Agence Rabat',
    de: 'Bassatine El Menzah',
    vers: 'Bassatine elmnzah',
    motif: 'un « e » ajouté',
  },

  // --- Meta Livraison -----------------------------------------------------
  {
    agence: 'Agence Khemisset',
    de: 'Sidi Allal Lbahraoui Kamoni',
    vers: 'sidi 3llal lbahraoui kamoni',
    motif: '« 3 » développé en « A », contrairement aux huit autres noms du fichier',
  },
  { agence: 'Agence Meknès', de: 'Sebaa Ayoun', vers: 'SEBA AYOUN', motif: 'un « a » ajouté' },
  { agence: 'Agence Meknès', de: 'Meknès', vers: 'meknes', motif: 'accent ajouté' },

  // --- Sahario Express ----------------------------------------------------
  { agence: 'Agence Agadir', de: 'Ait Melloul', vers: 'ait mlloul', motif: 'orthographe corrigée à l’import' },
];

const A_SUPPRIMER: { agence: string; nom: string; motif: string }[] = [
  // En-têtes de groupe des messages WhatsApp, créés à tort comme villes.
  { agence: 'Agence Agadir', nom: 'Taroudant', motif: 'en-tête de groupe' },
  { agence: 'Agence Agadir', nom: 'Tiznit', motif: 'en-tête de groupe' },
  { agence: 'Agence Agadir', nom: 'Oulad Teima', motif: 'en-tête de groupe' },

  // Doublons nés d'un rapprochement qui ignorait la casse mais pas les
  // ACCENTS : « Sale » ne retrouvait pas « Salé », l'import créait une seconde
  // ligne à côté. Corrigé dans resoudreVilleImport ; ces six-là restaient.
  // C'est la graphie ACCENTUÉE qui part — le fichier écrit sans accents.
  { agence: 'Agence Rabat', nom: 'Salé', motif: 'doublon accentué de « Sale »' },
  { agence: 'Agence Rabat', nom: 'Témara', motif: 'doublon accentué de « Temara »' },
  { agence: 'Agence Rabat', nom: 'Kénitra', motif: 'doublon accentué de « Kenitra »' },
  { agence: 'Agence Rabat', nom: 'Aïn Atiq', motif: 'doublon accentué de « Ain atiq »' },
  { agence: 'Agence Rabat', nom: 'Aïn Aouda', motif: 'doublon accentué de « Ain aouda »' },
  { agence: 'Agence Rabat', nom: 'Salé El Jadida', motif: 'doublon accentué de « Sale el jadida »' },
];

// Null plutôt qu'une exception si le hub n'existe pas : ce script est enchaîné
// AVANT les imports dans `npm run db:reseau`, et sur une base fraîchement
// migrée aucun hub n'existe encore. Il doit alors ne rien faire, silencieusement,
// et laisser les imports créer directement les bons noms.
async function hubParNom(nom: string) {
  return prisma.hub.findUnique({ where: { nom }, select: { id: true } });
}

async function main() {
  console.log('--- Graphies rendues au document ---');
  let renommees = 0;
  for (const { agence, de, vers, motif } of RENOMMAGES) {
    const hub = await hubParNom(agence);
    if (!hub) continue;
    const ville = await prisma.ville.findUnique({ where: { hubId_nom: { hubId: hub.id, nom: de } } });
    if (!ville) {
      console.log(`   (sans effet : "${de}" absente de ${agence})`);
      continue;
    }
    await prisma.ville.update({ where: { id: ville.id }, data: { nom: vers } });
    console.log(`   ${agence.padEnd(20)} "${de}" → "${vers}"   [${motif}]`);
    renommees += 1;
  }

  console.log('\n--- Villes à retirer ---');
  let supprimees = 0;
  for (const { agence, nom, motif } of A_SUPPRIMER) {
    const hub = await hubParNom(agence);
    if (!hub) continue;
    const ville = await prisma.ville.findUnique({
      where: { hubId_nom: { hubId: hub.id, nom } },
      select: {
        id: true,
        _count: { select: { commandes: true, tarifsLivreurs: true, tarifsMarchands: true } },
      },
    });
    if (!ville) {
      console.log(`   (déjà absente : "${nom}")`);
      continue;
    }

    const { commandes, tarifsLivreurs, tarifsMarchands } = ville._count;
    if (commandes + tarifsLivreurs + tarifsMarchands > 0) {
      console.log(
        `   ⚠ "${nom}" CONSERVÉE — ${commandes} colis, ${tarifsLivreurs} tarif(s) livreur, ${tarifsMarchands} tarif(s) marchand rattachés.`
      );
      continue;
    }

    await prisma.ville.delete({ where: { id: ville.id } });
    console.log(`   − "${nom}" supprimée (${motif})`);
    supprimees += 1;
  }

  const agadir = await prisma.hub.findUnique({
    where: { nom: 'Agence Agadir' },
    select: { _count: { select: { villes: true } } },
  });

  console.log(`\nTerminé — ${renommees} renommage(s), ${supprimees} suppression(s).`);
  console.log(
    `Agence Agadir : ${agadir?._count.villes ?? '?'} villes` +
      (agadir?._count.villes === 51 ? '  ✔ conforme aux messages' : '  ⚠ 51 attendues')
  );
  console.log('\nLa casse n’est pas traitée ici : elle reste normalisée sur Power, Meta et Sahario.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
