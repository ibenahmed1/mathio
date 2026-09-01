import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport } from '../lib/prestataires';

/**
 * Import du réseau Meta Livraison (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-prestataire-meta-livraison.ts`.
 *
 * Même nature que scripts/import-prestataire-power-delivery.ts — chargement
 * initial d'un réseau fournisseur, idempotent, non destructif — mais le
 * fichier source ("metalivraison.csv", programme 2026) diffère sur deux points
 * qui comptent :
 *
 *  1. AUCUN TARIF. La grille Power Delivery donnait un prix par ville ; celle-ci
 *     n'a que des zones et des jours. Aucune ligne TarifPrestataireVille n'est
 *     donc créée : les colis livrés dans ces villes apparaîtront en « coût
 *     inconnu » à la facturation (cf. Facture.nbLignesCoutInconnu) tant que les
 *     prix ne sont pas saisis depuis /admin/hubs.
 *
 *  2. UN PROGRAMME HEBDOMADAIRE, que le modèle ne sait pas encore porter. Il est
 *     transcrit ci-dessous dans `jours` — donnée morte pour la base, mais le
 *     fichier n'existera pas éternellement et le retranscrire plus tard coûterait
 *     le double. Masque de 7 caractères, lundi → dimanche : 'x' desservi,
 *     '-' non desservi, '?' non renseigné dans le fichier.
 *
 * Le CSV groupait les villes par SECTEUR (une ligne = plusieurs localités
 * partageant les mêmes jours, séparées par des « / »). Ce regroupement est
 * conservé ici pour rester lisible face au fichier, mais chaque localité devient
 * une Ville distincte : `Commande.ville` est du texte libre rapproché par
 * normalisation, et un secteur composé ne serait jamais reconnu.
 */

const PRESTATAIRE = 'Meta Livraison';

type Secteur = {
  // Masque lundi→dimanche. Non persisté (voir en-tête).
  jours: string;
  // Note du fichier quand il donne une phrase au lieu d'une grille.
  note?: string;
  villes: string[];
};

type AgenceImport = { hub: string; ville: string; secteurs: Secteur[] };

// « kolnhar machi fnharha » / « fnharhom » : livré tous les jours, mais pas le
// jour même du dépôt. C'est une règle de délai, pas un calendrier — d'où le
// masque '?' plutôt qu'une semaine pleine qu'on aurait inventée.
const TOUS_JOURS_SAUF_JOUR_MEME = 'kolnhar machi fnharha — tous les jours, mais pas le jour même';

const AGENCES: AgenceImport[] = [
  {
    hub: 'Agence Taounate',
    ville: 'Taounate',
    secteurs: [
      { jours: '-xxxxxx', villes: ['Rafsay', 'Wrtzag', 'Hajriya', 'Sahla Botahr', 'Mazraoua'] },
      { jours: 'xxxxxx-', villes: ['Taounate Centre', 'Rmila', 'Dchiyar'] },
      { jours: '-x-xxxx', villes: ['Galaz', 'Fricha', 'Timzgana'] },
      { jours: 'xxxxxxx', villes: ['Sidi Mkhfi', 'Hjar Ma3dan'] },
      { jours: '-xx--x-', villes: ['Ikaouen', 'Bab Jbah'] },
      // « Kantra Asqar » figure aussi dans le secteur Mrouj ci-dessous, avec des
      // jours différents. Première occurrence retenue, cf. le rapport de fin.
      { jours: '-xx--x-', villes: ['Khlalfa', 'Zrizer', 'Kantra Asqar'] },
      { jours: '-xx--x-', villes: ['Imghden', 'Taounat Aqchour', 'Machkour'] },
      { jours: 'x--x---', villes: ['Marnissa', 'Thar Souk', 'Kantra Jdida'] },
      { jours: 'xxxx-x-', villes: ['Mrouj', 'Bouhouda', 'Bni Wlid'] },
      { jours: 'x-x-x--', villes: ['Bouadil', 'Ain Madyouna', 'Wlad Azam'] },
      { jours: 'xxxxxx-', villes: ['Wlad Daouad', 'Kanssara', 'Firma Pla'] },
      { jours: 'xxxxxx-', villes: ['Tissa'] },
      { jours: '-x-x-x-', villes: ['Ain Aicha'] },
    ],
  },
  {
    hub: 'Agence Taza',
    ville: 'Taza',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['Taza', 'Guercif', 'Taourirt', 'Tahla'] },
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['Ouad Amlil'] },
      // Le fichier liste ces localités sans aucun jour coché : elles sont
      // desservies par l'agence, le calendrier n'est simplement pas rempli.
      {
        jours: '???????',
        villes: [
          'Aknoul',
          'Tiziousli',
          'Ajdir Taza',
          'Boured',
          'Sidi Ali Bourekba',
          'Bab Marzoka',
          'Taddart Guerci',
          'Marzou9a',
          'Bni Ftaah',
          'Sabt Bou9lal',
          'Bouhlou',
          'Jbarna',
        ],
      },
    ],
  },
  {
    hub: 'Agence Missour',
    ville: 'Missour',
    secteurs: [
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['Outat El Haj'] },
      { jours: '---x--x', villes: ['Imouzzer Marmocha'] },
      { jours: '???????', villes: ['Missour', 'Tandit'] },
    ],
  },
  {
    hub: 'Agence Boulmane',
    ville: 'Boulmane',
    secteurs: [
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['Guigo'] },
      { jours: '???????', villes: ['Timahdit'] },
    ],
  },
  {
    hub: 'Agence Khemisset',
    ville: 'Khemisset',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['Khemisset'] },
      // Le fichier écrit « sidi 3llal lbahraoui kamoni » d'un seul tenant, sans
      // séparateur : conservé tel quel plutôt que découpé au jugé.
      { jours: 'x-x-x--', villes: ['Sidi Allal Lbahraoui Kamoni'] },
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['Ain Sbiit'] },
      { jours: '???????', villes: ['Tifelt', 'Oualmas', 'Romani', 'Lma3ziz', 'Tedass', 'Jm3at Hodran'] },
    ],
  },
  {
    hub: 'Agence Azrou',
    ville: 'Azrou',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['Azrou', 'Ifrane'] },
      { jours: '--x--x-', villes: ['Ain Louh', 'Sidi 3edi'] },
      { jours: '???????', villes: ['Ait Yahya Oualla', 'Ait Amour Ouali'] },
    ],
  },
  {
    hub: 'Agence Meknès',
    ville: 'Meknès',
    secteurs: [
      {
        jours: 'xxxxxx-',
        villes: [
          'Meknès',
          'Lhajeb',
          'Boufakrane',
          'Mejjat',
          'Sidi Slimen Moul Lkifan',
          'Lhaj 9adour',
          'Dar Oum Soultan',
        ],
      },
      { jours: 'xx-x---', villes: ['Ouad Jdida', 'Sebaa Ayoun'] },
      { jours: '-x-x-x-', villes: ['Kantina', 'Agouray', 'Jeri', 'Sebt Jehjouh', 'Ait Ya3zem'] },
      { jours: '---x-x-', villes: ['Ain Karma'] },
      { jours: 'x-x-x--', villes: ['Sidi Ali', 'Ragouba'] },
      { jours: 'x--x---', villes: ['Dkhissa'] },
      { jours: '???????', villes: ['Moulay Driss Zerhouni'] },
    ],
  },
  {
    hub: 'Agence Sefrou',
    ville: 'Sefrou',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['Sefrou', 'Bhalil'] },
      { jours: 'x-x-x--', villes: ['Ras Tbouda', 'Bir Tamtam', 'Azzaba', 'El Menzel', 'Bodrahm', 'Rebat Lkhir'] },
      { jours: 'x---x--', villes: ['Zaouiat Bougrine'] },
    ],
  },
  {
    hub: 'Agence Fès',
    ville: 'Fès',
    secteurs: [
      { jours: '--x--x-', villes: ['Moulay Yaacoub'] },
      { jours: 'x--x---', villes: ['Sidi Hrazem'] },
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
  const conflits: string[] = [];
  const doublons: string[] = [];
  const dejaVues = new Set<string>();

  for (const agence of AGENCES) {
    const hub = await resoudreHubImport({
      prestataireId: prestataire.id,
      ville: agence.ville,
      nom: agence.hub,
    });

    const villes = agence.secteurs.flatMap((s) => s.villes);
    console.log(`\n${hub.nom} — ${villes.length} villes`);

    for (const nom of villes) {
      if (dejaVues.has(nom)) {
        doublons.push(nom);
        continue;
      }
      dejaVues.add(nom);

      // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville).
      // L'homonymie avec la ville d'un autre réseau n'est plus un conflit à
      // signaler : chaque prestataire tient sa propre liste, et deux
      // transporteurs qui desservent Aknoul y ont chacun leur ligne.
      const existante = await prisma.ville.findUnique({
        where: { hubId_nom: { hubId: hub.id, nom } },
      });

      if (!existante) {
        await prisma.ville.create({ data: { nom, hubId: hub.id } });
        creees += 1;
      }
    }
  }

  console.log(`\nTerminé — ${creees} villes créées sous ${AGENCES.length} agences ${prestataire.nom}.`);
  console.log('Aucun tarif chargé : le fichier source n\'en contient pas.');
  if (doublons.length > 0) {
    console.log(`\nDoublons du fichier (première occurrence retenue) : ${doublons.join(', ')}`);
  }
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
