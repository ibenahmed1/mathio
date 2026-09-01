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

// En-têtes de groupe des messages WhatsApp, créés à tort comme villes.
const A_SUPPRIMER: { agence: string; nom: string }[] = [
  { agence: 'Agence Agadir', nom: 'Taroudant' },
  { agence: 'Agence Agadir', nom: 'Tiznit' },
  { agence: 'Agence Agadir', nom: 'Oulad Teima' },
];

async function hubParNom(nom: string) {
  const hub = await prisma.hub.findUnique({ where: { nom }, select: { id: true } });
  if (!hub) throw new Error(`Hub introuvable : "${nom}"`);
  return hub;
}

async function main() {
  console.log('--- Graphies rendues au document ---');
  let renommees = 0;
  for (const { agence, de, vers, motif } of RENOMMAGES) {
    const hub = await hubParNom(agence);
    const ville = await prisma.ville.findUnique({ where: { hubId_nom: { hubId: hub.id, nom: de } } });
    if (!ville) {
      console.log(`   (sans effet : "${de}" absente de ${agence})`);
      continue;
    }
    await prisma.ville.update({ where: { id: ville.id }, data: { nom: vers } });
    console.log(`   ${agence.padEnd(20)} "${de}" → "${vers}"   [${motif}]`);
    renommees += 1;
  }

  console.log('\n--- En-têtes pris pour des villes ---');
  let supprimees = 0;
  for (const { agence, nom } of A_SUPPRIMER) {
    const hub = await hubParNom(agence);
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
    console.log(`   − "${nom}" supprimée (en-tête de groupe, pas une destination)`);
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
