import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

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
      { jours: '-xxxxxx', villes: ['Rafsay', 'wrtzag', 'hajriya', 'sahla botahr', 'mazraoua'] },
      { jours: 'xxxxxx-', villes: ['taounate centre', 'rmila', 'dchiyar'] },
      { jours: '-x-xxxx', villes: ['galaz', 'fricha', 'timzgana'] },
      { jours: 'xxxxxxx', villes: ['sidi mkhfi', 'hjar ma3dan'] },
      { jours: '-xx--x-', villes: ['ikaouen', 'bab jbah'] },
      // « kantra asqar » figure aussi dans le secteur mrouj ci-dessous, avec des
      // jours différents. Première occurrence retenue, cf. le rapport de fin.
      { jours: '-xx--x-', villes: ['khlalfa', 'zrizer', 'kantra asqar'] },
      { jours: '-xx--x-', villes: ['imghden', 'taounat aqchour', 'machkour'] },
      { jours: 'x--x---', villes: ['marnissa', 'thar souk', 'kantra jdida'] },
      { jours: 'xxxx-x-', villes: ['mrouj', 'bouhouda', 'bni wlid'] },
      { jours: 'x-x-x--', villes: ['bouadil', 'ain madyouna', 'wlad azam'] },
      { jours: 'xxxxxx-', villes: ['wlad daouad', 'kanssara', 'firma pla'] },
      { jours: 'xxxxxx-', villes: ['tissa'] },
      { jours: '-x-x-x-', villes: ['AIN AICHA'] },
    ],
  },
  {
    hub: 'Agence Taza',
    ville: 'Taza',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['TAZA', 'GUERCIF', 'TAOURIRT', 'TAHLA'] },
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['OUAD AMLIL'] },
      // Le fichier liste ces localités sans aucun jour coché : elles sont
      // desservies par l'agence, le calendrier n'est simplement pas rempli.
      {
        jours: '???????',
        villes: [
          'AKNOUL',
          'TIZIOUSLI',
          'AJDIR TAZA',
          'BOURED',
          'SIDI ALI BOUREKBA',
          'BAB MARZOKA',
          'TADDART GUERCI',
          'marzou9a',
          'bni ftaah',
          'sabt bou9lal',
          'bouhlou',
          'jbarna',
        ],
      },
    ],
  },
  {
    hub: 'Agence Missour',
    ville: 'Missour',
    secteurs: [
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['outat el haj'] },
      { jours: '---x--x', villes: ['imouzzer marmocha'] },
      { jours: '???????', villes: ['missour', 'tandit'] },
    ],
  },
  {
    hub: 'Agence Boulmane',
    ville: 'Boulmane',
    secteurs: [
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['guigo'] },
      { jours: '???????', villes: ['timahdit'] },
    ],
  },
  {
    hub: 'Agence Khemisset',
    ville: 'Khemisset',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['khemisset'] },
      // Écrit d'un seul tenant dans le tableur, sans séparateur : conservé tel
      // quel plutôt que découpé au jugé. Le « 3 » de l'alphabet de discussion
      // (ع) est gardé, comme dans marzou9a, lma3ziz, jm3at hodran, sidi 3edi —
      // une version antérieure le développait en « A » sur ce seul nom.
      { jours: 'x-x-x--', villes: ['sidi 3llal lbahraoui kamoni'] },
      { jours: '???????', note: TOUS_JOURS_SAUF_JOUR_MEME, villes: ['ain sbiit'] },
      { jours: '???????', villes: ['tifelt', 'oualmas', 'romani', 'lma3ziz', 'tedass', 'jm3at hodran'] },
    ],
  },
  {
    hub: 'Agence Azrou',
    ville: 'Azrou',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['azrou', 'ifrane'] },
      { jours: '--x--x-', villes: ['ain louh', 'sidi 3edi'] },
      { jours: '???????', villes: ['ait yahya oualla', 'ait amour ouali'] },
    ],
  },
  {
    hub: 'Agence Meknès',
    ville: 'Meknès',
    secteurs: [
      {
        jours: 'xxxxxx-',
        villes: [
          // Graphie du tableur (« meknes »), sans l'accent ajouté à l'import.
          'meknes',
          'lhajeb',
          'boufakrane',
          'mejjat',
          'sidi slimen moul lkifan',
          'lhaj 9adour',
          'dar oum soultan',
        ],
      },
      // « SEBA AYOUN » dans le tableur — un « a » avait été ajouté à l'import.
      { jours: 'xx-x---', villes: ['ouad jdida', 'SEBA AYOUN'] },
      { jours: '-x-x-x-', villes: ['kantina', 'AGOURAY', 'JERI', 'sebt jehjouh', 'ait ya3zem'] },
      { jours: '---x-x-', villes: ['ain karma'] },
      { jours: 'x-x-x--', villes: ['sidi ali', 'ragouba'] },
      { jours: 'x--x---', villes: ['dkhissa'] },
      { jours: '???????', villes: ['moulay driss zerhouni'] },
    ],
  },
  {
    hub: 'Agence Sefrou',
    ville: 'Sefrou',
    secteurs: [
      { jours: 'xxxxxx-', villes: ['SEFROU', 'BHALIL'] },
      { jours: 'x-x-x--', villes: ['RAS TBOUDA', 'BIR TAMTAM', 'AZZABA', 'EL MENZEL', 'BODRAHM', 'REBAT LKHIR'] },
      { jours: 'x---x--', villes: ['ZAOUIAT BOUGRINE'] },
    ],
  },
  {
    hub: 'Agence Fès',
    ville: 'Fès',
    secteurs: [
      { jours: '--x--x-', villes: ['MOULAY YAACOUB'] },
      { jours: 'x--x---', villes: ['SIDI HRAZEM'] },
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
    if (hub.renommeDepuis) console.log(`   Hub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);

    for (const nom of villes) {
      if (dejaVues.has(nom)) {
        doublons.push(nom);
        continue;
      }
      dejaVues.add(nom);

      // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville).
      // L'homonymie avec la ville d'un autre réseau n'est plus un conflit à
      // signaler : chaque prestataire tient sa propre liste, et deux
      // transporteurs qui desservent AKNOUL y ont chacun leur ligne, chacune
      // écrite comme son fichier l'écrit.
      const ville = await resoudreVilleImport(hub.id, nom);
      if (ville.cree) creees += 1;
      if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);
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
