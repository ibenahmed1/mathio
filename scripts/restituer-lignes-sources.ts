import 'dotenv/config';
import { prisma } from '../lib/prisma';

/**
 * Restitution ligne à ligne des grilles fournisseurs — à exécuter UNE fois,
 * après la migration `ville_unique_par_hub`, via
 * `npx tsx scripts/restituer-lignes-sources.ts`.
 *
 * OBJECTIF : que l'écran /admin/hubs affiche exactement ce que contiennent les
 * fichiers reçus, sans ligne écartée ni orthographe réécrite.
 *
 * Les cinq imports initiaux fusionnaient les doublons et normalisaient les
 * noms, parce que `Ville.nom` était unique pour tout le réseau : deux lignes
 * portant le même nom, ou une ville annoncée par deux prestataires, ne
 * POUVAIENT pas coexister. La contrainte porte désormais sur (hub, nom), ce qui
 * lève l'essentiel du problème — mais les lignes déjà écartées ne reviennent
 * pas toutes seules. C'est le rôle de ce script.
 *
 * Il est NON DESTRUCTIF pour l'historique : les villes déjà en base sont
 * RENOMMÉES vers l'orthographe de leur fichier, jamais supprimées puis
 * recréées. Un colis, un tarif livreur ou un tarif marchand qui pointe vers
 * l'une d'elles continue donc de pointer vers la même ligne.
 *
 * DEUX LIGNES RESTENT IMPOSSIBLES À RESTITUER, et le script le dit à la fin :
 * un doublon EXACT à l'intérieur d'une même agence (« ouargui » deux fois chez
 * Power Delivery/Marrakech, « kantra asqar » deux fois chez Meta
 * Livraison/Taounate). Deux lignes identiques, même agence, même prix : la base
 * ne peut pas les distinguer, et l'écran afficherait deux puces jumelles sans
 * qu'aucune action ne puisse viser l'une plutôt que l'autre. Les conserver
 * exigerait de renoncer à toute unicité sur la ville, donc de casser le
 * rapprochement des colis saisis en texte libre.
 */

// Orthographe à rétablir : nom actuel en base → texte exact du fichier.
// Chaque entrée est rattachée à son agence, car le même nom peut exister
// légitimement ailleurs sous une autre graphie.
const RENOMMAGES: { agence: string; de: string; vers: string }[] = [
  // --- Power Delivery (PDF « ville Power.pdf ») ---------------------------
  { agence: 'Agence El Jadida', de: 'El Jadida', vers: 'l jadida' },
  { agence: 'Agence El Jadida', de: 'Tnin Chtouka', vers: 'TNIN CHTOUKA - EL JADIDA' },
  { agence: 'Agence Marrakech', de: 'Sidi Moussa (Marrakech)', vers: 'Sidi moussa - Marrakech' },
  // Le fichier écrit ces villes DEUX fois, avec deux graphies. La première
  // occurrence reprend son nom d'origine ; la seconde est recréée plus bas.
  { agence: 'Agence Marrakech', de: 'Aït Ourir', vers: 'ait aourir' },
  { agence: 'Agence Marrakech', de: 'Tamallalt', vers: 'tamelelt' },
  { agence: 'Agence Rabat', de: 'Tamesna', vers: 'TEMSENA' },

  // --- Sahario Express ----------------------------------------------------
  // La précision « (Oulad Teima) » servait à éviter la collision avec la Sidi
  // Moussa de Marrakech. Les deux peuvent désormais coexister.
  { agence: 'Agence Agadir', de: 'Sidi Moussa (Oulad Teima)', vers: 'Sidi moussa' },

  // --- EST Livraison (PDF « GRILLE TARIFAIRE OFFICIELLE ») -----------------
  { agence: 'Agence Oujda', de: 'Oujda', vers: 'Oujda (Centre & Quartiers)' },
  { agence: 'Agence Oujda', de: 'Beni Drar', vers: 'Beni Drar (Bnidrar)' },
  { agence: 'Agence Oujda', de: 'Ras El Ma', vers: "Ras El Ma (Cap de l'Eau)" },
  { agence: 'Agence Oujda', de: 'Nador', vers: 'Nador Ville' },
  { agence: 'Agence Oujda', de: 'Al Hoceima', vers: 'Al Hoceima Ville' },
];

// Lignes des fichiers qui n'avaient jamais été créées, parce qu'un autre nom
// occupait déjà la place. `tarif` est celui de la ligne dans son fichier.
const A_CREER: { agence: string; nom: string; tarif: number | null; tarifRetour: number | null; motif: string }[] = [
  // --- Power Delivery : secondes graphies du même fichier ------------------
  { agence: 'Agence Marrakech', nom: 'Aït ourir', tarif: 25, tarifRetour: null, motif: 'seconde graphie (p.2)' },
  { agence: 'Agence Marrakech', nom: 'Tamallalt', tarif: 25, tarifRetour: null, motif: 'seconde graphie (p.2)' },
  { agence: 'Agence Rabat', nom: 'Tamssna', tarif: 25, tarifRetour: null, motif: 'seconde graphie' },

  // --- EST Livraison : sa Province de Taza --------------------------------
  // Ces dix villes existaient déjà chez Meta Livraison. L'import EST les avait
  // laissées là-bas et posé son tarif SUR les lignes de Meta, faute de pouvoir
  // créer les siennes. EST a maintenant sa propre couverture, et la grille de
  // chaque réseau redevient lisible pour ce qu'elle est.
  ...[
    'Taza Ville',
    'Tahla',
    'Oued Amlil',
    'Aknoul',
    'Tizi Ouzli',
    'Ajdir-Taza',
    'Bouhlou',
    'Taourirt',
    'Guercif Ville',
    'Taddart',
  ].map((nom) => ({
    agence: 'Agence Oujda',
    nom,
    tarif: 25,
    tarifRetour: 0,
    motif: 'couverture EST Livraison, jusqu’ici absorbée par Meta Livraison',
  })),
];

// Doublons EXACTS à l'intérieur d'une même agence : irréductibles (cf. en-tête).
const IRREDUCTIBLES = [
  'Power Delivery / Agence Marrakech — « ouargui » figure 2 fois dans le fichier',
  'Meta Livraison / Agence Taounate — « kantra asqar » figure 2 fois dans le fichier',
];

async function hubParNom(nom: string) {
  const hub = await prisma.hub.findUnique({
    where: { nom },
    select: { id: true, nom: true, prestataireId: true },
  });
  if (!hub) throw new Error(`Hub introuvable : "${nom}"`);
  return hub;
}

async function main() {
  let renommees = 0;
  let creees = 0;
  let tarifsPoses = 0;
  let tarifsRetires = 0;
  const ignores: string[] = [];

  console.log('--- Orthographes rétablies ---');
  for (const { agence, de, vers } of RENOMMAGES) {
    const hub = await hubParNom(agence);
    const ville = await prisma.ville.findUnique({ where: { hubId_nom: { hubId: hub.id, nom: de } } });
    if (!ville) {
      ignores.push(`renommage ignoré : "${de}" absente de ${agence}`);
      continue;
    }
    await prisma.ville.update({ where: { id: ville.id }, data: { nom: vers } });
    console.log(`   ${agence.padEnd(20)} "${de}" → "${vers}"`);
    renommees += 1;
  }

  console.log('\n--- Lignes restituées ---');
  for (const ligne of A_CREER) {
    const hub = await hubParNom(ligne.agence);
    const existante = await prisma.ville.findUnique({
      where: { hubId_nom: { hubId: hub.id, nom: ligne.nom } },
    });
    if (existante) {
      ignores.push(`création ignorée : "${ligne.nom}" existe déjà dans ${ligne.agence}`);
      continue;
    }

    const ville = await prisma.ville.create({ data: { nom: ligne.nom, hubId: hub.id } });
    creees += 1;
    console.log(`   ${ligne.agence.padEnd(20)} + "${ligne.nom}"  (${ligne.motif})`);

    if (ligne.tarif !== null && hub.prestataireId) {
      await prisma.tarifPrestataireVille.create({
        data: {
          prestataireId: hub.prestataireId,
          villeId: ville.id,
          tarifLivraison: ligne.tarif,
          tarifRetour: ligne.tarifRetour,
        },
      });
      tarifsPoses += 1;
    }
  }

  // Les tarifs qu'EST Livraison avait posés sur les villes de Meta Livraison
  // n'ont plus lieu d'être : EST possède désormais ses propres lignes. Les
  // laisser ferait croire qu'EST tarife la couverture d'un concurrent.
  const est = await prisma.prestataire.findUnique({ where: { nom: 'EST Livraison' } });
  if (est) {
    const orphelins = await prisma.tarifPrestataireVille.findMany({
      where: { prestataireId: est.id, ville: { hub: { prestataireId: { not: est.id } } } },
      select: { id: true, ville: { select: { nom: true, hub: { select: { nom: true } } } } },
    });
    for (const o of orphelins) {
      console.log(`\n   tarif EST retiré de "${o.ville.nom}" (${o.ville.hub.nom}) — EST a désormais sa propre ligne`);
    }
    if (orphelins.length > 0) {
      await prisma.tarifPrestataireVille.deleteMany({ where: { id: { in: orphelins.map((o) => o.id) } } });
      tarifsRetires = orphelins.length;
    }
  }

  console.log(
    `\nTerminé — ${renommees} villes renommées, ${creees} lignes restituées, ${tarifsPoses} tarifs posés, ${tarifsRetires} tarifs déplacés.`
  );

  if (ignores.length > 0) {
    console.log('\nÉtapes sans effet (déjà appliquées ?) :');
    for (const i of ignores) console.log(`   ${i}`);
  }

  console.log('\nLignes IMPOSSIBLES à restituer (doublon exact dans la même agence) :');
  for (const i of IRREDUCTIBLES) console.log(`   ${i}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
