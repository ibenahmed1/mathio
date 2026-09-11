import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';

/**
 * Audit de conformité des grilles fournisseurs — `npx tsx
 * scripts/auditer-conformite-sources.ts`.
 *
 * CE QUE CET AUDIT PROUVE, ET CE QU'IL NE PROUVE PAS.
 *
 * Le tableau SOURCE ci-dessous est une SECONDE transcription des documents
 * reçus, faite indépendamment des scripts d'import. La comparer à la base
 * attrape les fautes de recopie : une ville rangée dans la mauvaise agence, un
 * tarif décalé d'une ligne, une ligne sautée, une ligne en trop.
 *
 * Il ne prouve PAS que la transcription elle-même est fidèle au document. Deux
 * transcriptions faites par la même main peuvent partager la même erreur de
 * lecture. Le seul contrôle qui ferme vraiment la boucle est celui que fait le
 * lecteur du fichier d'origine : c'est l'objet de
 * `scripts/exporter-grilles-prestataires.ts`, qui recrache la base au format
 * tableur pour être posée à côté de l'Excel reçu.
 *
 * La comparaison porte sur le nom NORMALISÉ (casse et accents neutralisés,
 * cf. normaliserVille) : c'est le contenu qui est audité — quelle ville, quelle
 * agence, quel prix — pas la graphie. Les écarts de graphie sont listés à part.
 */

type LigneSource = {
  agence: string;
  nom: string;
  tarif: number | null;
  retour?: number | null;
  // Prestataire dont la grille porte cette ligne. Renseigné uniquement quand il
  // n'est pas celui du hub : les 13 villes du HUB CASABLANCA viennent du fichier
  // Power Delivery alors que le hub, lui, est INTERNE et n'a pas de prestataire.
  // Sans ça, l'audit cherchait un tarif « du prestataire null » et déclarait les
  // treize lignes non tarifées, alors qu'elles le sont.
  prestataire?: string;
};

// Construit les lignes d'une zone à tarif unique.
const zone = (
  agence: string,
  tarif: number | null,
  noms: string[],
  retour: number | null = null,
  prestataire?: string
): LigneSource[] => noms.map((nom) => ({ agence, nom, tarif, retour, prestataire }));

const SOURCE: LigneSource[] = [
  // ══ Power Delivery — « ville Power.pdf » (91 lignes) ═══════════════════
  ...zone('Hub Casablanca', 15, ['Casablanca'], null, 'Power Delivery'),
  ...zone(
    'Hub Casablanca',
    20,
    [
      'Bouskoura', 'TIT MELIL', 'Dar bouazza', 'Deroua', 'NOUACER', 'TAMARIS', 'MEDIOUNA',
      'Berrechid', 'SIDI HAJAJ', 'SETTAT', 'Ben ahmed', 'Lahraouyine',
    ],
    null,
    'Power Delivery'
  ),
  ...zone('Agence El Jadida', 20, ['l jadida']),
  ...zone('Agence El Jadida', 23, [
    'SIDI RAHAL', 'Azemmour', 'Sidi bouzid', 'TNIN CHTOUKA - EL JADIDA', 'Bir jdid', 'SIDI SMAIL',
    'MOULAY ABDELLAH', 'Had soualem',
  ]),
  ...zone('Agence El Jadida', 25, ['Khemis des zemamra', 'SIDI BENNOUR']),
  ...zone('Agence Marrakech', 20, ['Marrakech']),
  ...zone('Agence Marrakech', 25, [
    'Ben Guerir', 'Demnat', 'TAMANSOURT', 'ait aourir', 'El Kelaâ des Sraghna', 'Chichaoua',
    'El attaouia', 'ouled yahya', 'tamelelt', 'Sidi bou othmane', 'mzoudia', 'Mzouda', 'ouargui',
    'kettara', 'lamnabeha', 'ras elain erhamna', 'skhour rehamna', 'tassoultante', 'sid mokhtar',
    'lalla takerkoust', 'moulay brahim', 'tahannaout', 'aghmat', 'sidi ghiat', 'ouled hassoune',
    'tassaout', 'Sidi zouine', 'loudaya', 'souihla', 'Ourika', 'Tamallalt', 'choueiter', 'Amizmiz',
    'Aït ourir', 'Imintanoute', 'tameslouhte', 'Echemmaia', 'YOUSSOUFIA', 'ASNI', 'el ouidane',
    'Ouaht sidi brahim', 'Sidi moussa - Marrakech',
  ]),
  ...zone('Agence Safi', 23, ['SAFI', 'Essaouira', 'SEBT GZOULA', 'Jemaa shaim']),
  ...zone('Agence Rabat', 20, ['Rabat']),
  ...zone('Agence Rabat', 23, ['Sale', 'Temara']),
  ...zone('Agence Rabat', 25, [
    'Kenitra', 'Bouknadel', 'Harhoura', 'Mers el kheir', 'Ain atiq', 'Skhirate', 'TEMSENA',
    'Ain aouda', 'Bouznika', 'Allal tazi', 'Tamssna', 'Benslimane', 'El arjat', 'Sidi taibi',
    'Sale el jadida', 'Bassatine elmnzah',
  ]),

  // ══ Meta Livraison — « metalivraison.csv » (aucun tarif) ═══════════════
  // Graphies du tableur, VERBATIM. L'alphabet de discussion (« 3 » pour ع,
  // « 9 » pour ق) est conservé partout : c'est ainsi que le fournisseur écrit,
  // et le corriger sur un nom sans le corriger sur les huit autres ne produit
  // que de l'incohérence.
  ...zone('Agence Taounate', null, [
    'Rafsay', 'wrtzag', 'hajriya', 'sahla botahr', 'mazraoua', 'taounate centre', 'rmila', 'dchiyar',
    'galaz', 'fricha', 'timzgana', 'sidi mkhfi', 'hjar ma3dan', 'ikaouen', 'bab jbah', 'khlalfa',
    'zrizer', 'kantra asqar', 'imghden', 'taounat aqchour', 'machkour', 'marnissa', 'thar souk',
    'kantra jdida', 'mrouj', 'bouhouda', 'bni wlid', 'bouadil', 'ain madyouna', 'wlad azam',
    'wlad daouad', 'kanssara', 'firma pla', 'tissa', 'AIN AICHA',
  ]),
  ...zone('Agence Taza', null, [
    'TAZA', 'GUERCIF', 'TAOURIRT', 'TAHLA', 'OUAD AMLIL', 'AKNOUL', 'TIZIOUSLI', 'AJDIR TAZA',
    'BOURED', 'SIDI ALI BOUREKBA', 'BAB MARZOKA', 'TADDART GUERCI', 'marzou9a', 'bni ftaah',
    'sabt bou9lal', 'bouhlou', 'jbarna',
  ]),
  ...zone('Agence Missour', null, ['outat el haj', 'imouzzer marmocha', 'missour', 'tandit']),
  ...zone('Agence Boulmane', null, ['guigo', 'timahdit']),
  ...zone('Agence Khemisset', null, [
    'khemisset', 'sidi 3llal lbahraoui kamoni', 'ain sbiit', 'tifelt', 'oualmas', 'romani',
    'lma3ziz', 'tedass', 'jm3at hodran',
  ]),
  ...zone('Agence Azrou', null, ['azrou', 'ifrane', 'ain louh', 'sidi 3edi', 'ait yahya oualla', 'ait amour ouali']),
  ...zone('Agence Meknès', null, [
    'meknes', 'lhajeb', 'boufakrane', 'mejjat', 'sidi slimen moul lkifan', 'lhaj 9adour',
    'dar oum soultan', 'ouad jdida', 'SEBA AYOUN', 'kantina', 'AGOURAY', 'JERI', 'sebt jehjouh',
    'ait ya3zem', 'ain karma', 'sidi ali', 'ragouba', 'dkhissa', 'moulay driss zerhouni',
  ]),
  ...zone('Agence Sefrou', null, [
    'SEFROU', 'BHALIL', 'RAS TBOUDA', 'BIR TAMTAM', 'AZZABA', 'EL MENZEL', 'BODRAHM',
    'REBAT LKHIR', 'ZAOUIAT BOUGRINE',
  ]),
  ...zone('Agence Fès', null, ['MOULAY YAACOUB', 'SIDI HRAZEM']),

  // ══ Sahario Express (68 lignes) ════════════════════════════════════════
  ...zone('Agence Guelmim', 15, ['Guelmim']),
  ...zone('Agence Guelmim', 25, [
    'Bouizakarn', 'Sidi ifni', 'Mirleft', 'Assa', 'Zag', 'Tantan', 'El ouatia', 'Tarfaya',
    'Laayoune', 'Laayoune porte', 'Es semara', 'Boujdour', 'Dakhla',
  ]),
  ...zone('Agence Agadir', 15, ['Agadir', 'dchaira', 'inzgane', 'ait mlloul']),
  ...zone('Agence Agadir', 20, [
    'Sidi bibi', 'Anza', 'Aourir', 'Biougra', 'Ait aamira', 'Tadart anza', 'Tamraght', 'Tarast',
    'Drarga', 'Tikiwine', 'Leqliaa', 'tamait',
  ]),
  // Zone 23 : 35 localités, PAS 38. Les captures WhatsApp écrivent
  // « . Taroudant : », « . Tiznit : » et « . Oulad teima : » comme des
  // EN-TÊTES de groupe — un point devant, deux points derrière — et non comme
  // des villes desservies. Elles sont donc volontairement absentes ici : si la
  // base les contient, l'audit doit les remonter en « villes sans ligne
  // source », ce qui est précisément le cas aujourd'hui.
  ...zone('Agence Agadir', 23, [
    // groupe Taroudant
    'Zaouiat', 'iferkane', 'Ait aiaaza', 'El nouwayle', 'Oulad aarfa', 'taliwin', 'awlouz', 'oulad berhil',
    // groupe Tiznit
    'Anzi', 'tighmi', 'idawsmlal', 'tafraout', 'ait jraj', 'lakhssas', 'bounaiman', 'sihll',
    'merleft', 'sidi fini', 'aglou', 'lmaader', 'rasmouka', 'wijan',
    // groupe Oulad Teima, puis le message qui le suit (Belfaa → imi wadar)
    'Sidi moussa', 'lhamri', 'Sebt el guerdane', 'Douar sulad', 'said Qrarma', 'Lakhnafif',
    'El koudia', 'Lagfifat', 'Ain seddaq', 'Belfaa', 'massa', 'taghazout', 'imi wadar',
  ]),

  // ══ Amir Livraison — Agence Tanger (17 lignes) ═════════════════════════
  ...zone('Agence Tanger', 20, ['Tanger']),
  ...zone('Agence Tanger', 25, [
    'Tétouan', 'Martil', 'Fnideq', "M'diq", 'Ksar El Seghir', 'Ksar El Kebir', 'Larache', 'Asilah',
  ]),
  ...zone('Agence Tanger', 30, [
    'Ouezzane', 'Chefchaouen', 'Ain Drij', 'Zoumi', 'Bab Taza', 'Bab Berred', 'Oued Laou', 'El Jebha',
  ]),

  // ══ EST Livraison — Agence Oujda (63 lignes, retour 0 DH) ══════════════
  ...zone('Agence Oujda', 15, ['Oujda (Centre & Quartiers)'], 0),
  ...zone(
    'Agence Oujda',
    25,
    [
      'Beni Drar (Bnidrar)', 'Bni Oukil',
      'Berkane', 'Saidia', 'Ahfir', 'Aklim', 'Madagh', 'Fezouane', 'Cafimour', 'Lamriss', "Ras El Ma (Cap de l'Eau)",
      'Nador Ville', 'Selouane', 'El Aroui', 'Bni Ansar', 'Farkhana', 'Zeghanghane', 'Zaio', 'Bouarg', 'Ihdaden', 'Kariat Arekmane',
      'Driouch', 'Midar', 'Ben Tayeb', 'Kassita', 'Tafersit', 'Azlaf', 'Dar El Kebdani', 'Temsamane', 'Bodinar',
      'Al Hoceima Ville', 'Imzouren', 'Beni Bouayach', 'Targuist', 'Issaguen', 'Ajdir', 'Boukidaren', 'Bni Hadifa', 'Bni Boufrah',
      'Taourirt', 'Layoun Charkia', 'Guercif Ville', 'Taddart',
      'Taza Ville', 'Tahla', 'Oued Amlil', 'Aknoul', 'Tizi Ouzli', 'Ajdir-Taza', 'Gueldamane', 'Bouhlou', 'Had Oulad Zbair', 'Had Msila',
      'Jerada', 'Ain Bni Mathar', 'Guenfouda', 'Bouarfa', 'Tandrara', 'Figuig', 'Bni Tajjit', 'Bouanane', 'Talsint',
    ],
    0
  ),
];

// Doublons EXACTS d'une même agence : la base ne peut en porter qu'un (cf.
// scripts/restituer-lignes-sources.ts). Attendus, donc, et non signalés comme
// manquants.
const DOUBLONS_ATTENDUS = [
  { agence: 'Agence Marrakech', nom: 'ouargui' },
  { agence: 'Agence Taounate', nom: 'Kantra Asqar' },
];

async function main() {
  const [villes, prestataires] = await Promise.all([
    prisma.ville.findMany({
      select: {
        nom: true,
        hub: { select: { nom: true, prestataireId: true } },
        tarifsPrestataires: { select: { prestataireId: true, tarifLivraison: true, tarifRetour: true } },
      },
    }),
    prisma.prestataire.findMany({ select: { id: true, nom: true } }),
  ]);
  const idParNom = new Map(prestataires.map((p) => [p.nom, p.id]));

  // Index base : agence + nom normalisé -> la ville et TOUS ses tarifs. Le tarif
  // à comparer est choisi plus bas, ligne par ligne, car il dépend de la grille
  // dont la ligne provient (cf. LigneSource.prestataire).
  type EnBase = {
    nom: string;
    prestataireHub: string | null;
    tarifs: { prestataireId: string; tarifLivraison: unknown; tarifRetour: unknown }[];
  };
  const enBase = new Map<string, EnBase>();
  for (const v of villes) {
    enBase.set(`${v.hub.nom}|${normaliserVille(v.nom)}`, {
      nom: v.nom,
      prestataireHub: v.hub.prestataireId,
      tarifs: v.tarifsPrestataires,
    });
  }

  const tarifDe = (v: EnBase, prestataire?: string) => {
    const cible = prestataire ? idParNom.get(prestataire) : v.prestataireHub;
    const t = v.tarifs.find((x) => x.prestataireId === cible);
    return {
      tarif: t ? Number(t.tarifLivraison) : null,
      retour: t?.tarifRetour == null ? null : Number(t.tarifRetour),
    };
  };

  const manquantes: string[] = [];
  const tarifsFaux: string[] = [];
  const graphies: string[] = [];
  const vues = new Set<string>();

  for (const ligne of SOURCE) {
    const cle = `${ligne.agence}|${normaliserVille(ligne.nom)}`;
    const trouvee = enBase.get(cle);

    if (!trouvee) {
      const attendu = DOUBLONS_ATTENDUS.some(
        (d) => d.agence === ligne.agence && normaliserVille(d.nom) === normaliserVille(ligne.nom)
      );
      // Un doublon attendu apparaît deux fois dans SOURCE : la première
      // occurrence est trouvée, la seconde ne l'est pas — c'est normal.
      if (!(attendu && vues.has(cle))) manquantes.push(`${ligne.agence} / "${ligne.nom}"`);
      continue;
    }
    vues.add(cle);

    const { tarif, retour } = tarifDe(trouvee, ligne.prestataire);
    if (ligne.tarif !== null && tarif !== ligne.tarif) {
      tarifsFaux.push(`${ligne.agence} / "${ligne.nom}" : fichier ${ligne.tarif} DH, base ${tarif ?? '—'} DH`);
    }
    const retourAttendu = ligne.retour ?? null;
    if (retourAttendu !== null && retour !== retourAttendu) {
      tarifsFaux.push(
        `${ligne.agence} / "${ligne.nom}" : retour fichier ${retourAttendu} DH, base ${retour ?? '—'} DH`
      );
    }
    if (trouvee.nom !== ligne.nom) {
      graphies.push(`${ligne.agence} : base "${trouvee.nom}" ≠ fichier "${ligne.nom}"`);
    }
  }

  // Villes en base qu'aucune ligne source ne réclame. Les hubs fabriqués par
  // les scripts d'audit (§ scripts/test-tournee-cloture-audit.ts, recréés à
  // chaque exécution) sont hors périmètre : ils ne viennent d'aucune grille.
  const enTrop = [...enBase.entries()]
    .filter(([cle]) => !cle.startsWith('Hub Audit Tournée'))
    .filter(([cle]) => !SOURCE.some((l) => `${l.agence}|${normaliserVille(l.nom)}` === cle))
    .map(([cle, v]) => `${cle.split('|')[0]} / "${v.nom}"`);

  const bloc = (titre: string, lignes: string[]) => {
    console.log(`\n${titre} : ${lignes.length}`);
    for (const l of lignes) console.log(`   ${l}`);
  };

  console.log(`Lignes transcrites depuis les documents : ${SOURCE.length}`);
  console.log(`Villes en base                          : ${villes.length}`);

  bloc('LIGNES DU FICHIER ABSENTES DE LA BASE', manquantes);
  bloc('TARIFS DIVERGENTS', tarifsFaux);
  bloc('VILLES EN BASE SANS LIGNE SOURCE', enTrop);
  bloc('ÉCARTS DE GRAPHIE (contenu juste, casse différente)', graphies);

  const bloquant = manquantes.length + tarifsFaux.length + enTrop.length;
  console.log(
    bloquant === 0
      ? '\n✔ Contenu conforme : chaque ligne des fichiers est en base, dans la bonne agence, au bon prix.'
      : `\n✘ ${bloquant} écart(s) de CONTENU à examiner.`
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
