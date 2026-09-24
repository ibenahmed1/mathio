import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Reconnaissance de l'API Meta Livraison —
 * `npx tsx scripts/reconnaitre-meta-livraison.ts`.
 *
 * STRICTEMENT EN LECTURE, des deux côtés. Chez eux : `POST /auth` (qui ne crée
 * rien, c'est leur test de branchement), `GET /cities`, `GET /statuses`. Chez
 * nous : les villes rattachées aux agences Meta. Aucun colis n'est créé chez
 * eux, aucune ligne n'est écrite chez nous.
 *
 * Il existe parce que deux décisions du chantier ne se prennent pas sans leurs
 * données réelles :
 *   · la TRADUCTION DES STATUTS — leur documentation n'en montre que trois
 *     (`IN_PROGRESS`, `PROGRAMMER`, `POSTPONED`) ; la table de correspondance
 *     vers notre liste blanche s'écrit contre leur catalogue complet ;
 *   · le RAPPROCHEMENT DES VILLES — `POST /colis/bulk` refuse les noms de ville
 *     et exige leur `cityId`. Chacune de nos villes Meta doit donc retrouver son
 *     identifiant chez eux, et c'est le nombre de villes qui résistent qui dit
 *     si l'intégration est une affaire de jours ou de semaines.
 *
 * Le secret n'est JAMAIS affiché, ni en cas de succès ni en cas d'erreur : leur
 * documentation interdit qu'il apparaisse dans des logs, et la sortie de ce
 * script est faite pour être copiée telle quelle dans une discussion.
 */

const URL_PAR_DEFAUT = 'https://api.metalivraison.ma/colis-service';
const NOM_PRESTATAIRE = 'Meta Livraison';
// Un appel qui ne répond pas en 20 s ne répondra pas mieux en 60 : mieux vaut
// un échec lisible qu'un script qui semble figé.
const DELAI_MS = 20_000;

interface Identifiants {
  base: string;
  cle: string;
  secret: string;
}

interface VilleMeta {
  id: number;
  name: string;
}

interface Rapprochement {
  strict: { notre: string; agence: string; leur: VilleMeta }[];
  souple: { notre: string; agence: string; leur: VilleMeta }[];
  ambigu: { notre: string; agence: string; candidats: VilleMeta[] }[];
  absent: { notre: string; agence: string }[];
}

function lireIdentifiants(): Identifiants {
  const cle = process.env.META_LIVRAISON_CLE?.trim() ?? '';
  const secret = process.env.META_LIVRAISON_SECRET?.trim() ?? '';
  const base = (process.env.META_LIVRAISON_BASE_URL?.trim() || URL_PAR_DEFAUT).replace(/\/+$/, '');
  const manquants = [!cle && 'META_LIVRAISON_CLE', !secret && 'META_LIVRAISON_SECRET'].filter(Boolean);
  if (manquants.length > 0) {
    throw new Error(`Variables absentes ou vides dans .env : ${manquants.join(', ')}`);
  }
  return { base, cle, secret };
}

// Le corps d'une réponse en erreur est cité tronqué : assez pour comprendre,
// pas assez pour inonder la console d'une page HTML de proxy.
async function appeler(ids: Identifiants, methode: 'GET' | 'POST', chemin: string): Promise<unknown> {
  const reponse = await fetch(`${ids.base}${chemin}`, {
    method: methode,
    headers: {
      'X-API-Key': ids.cle,
      'X-API-Secret': ids.secret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DELAI_MS),
  });
  const texte = await reponse.text();
  if (!reponse.ok) {
    const attente = reponse.headers.get('retry-after');
    const extrait = texte.slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(
      `${methode} ${chemin} → HTTP ${reponse.status}` +
        (attente ? ` (Retry-After: ${attente})` : '') +
        (extrait ? ` — ${extrait}` : '')
    );
  }
  if (!texte) return null;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return texte;
  }
}

// Leur doc annonce un tableau nu ; on accepte aussi une enveloppe `{ content }`
// ou `{ data }`, fréquente chez les API Spring (leurs BL sont paginés ainsi).
function enTableau(valeur: unknown): unknown[] {
  if (Array.isArray(valeur)) return valeur;
  if (valeur && typeof valeur === 'object') {
    for (const cle of ['content', 'data', 'items']) {
      const v = (valeur as Record<string, unknown>)[cle];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function lireVilles(valeur: unknown): VilleMeta[] {
  return enTableau(valeur).flatMap((v) => {
    if (!v || typeof v !== 'object') return [];
    const { id, name } = v as Record<string, unknown>;
    return typeof id === 'number' && typeof name === 'string' ? [{ id, name }] : [];
  });
}

// Deuxième passe, plus tolérante que `normaliserVille` : tirets, points et
// espaces multiples replient sur un seul espace. Ses correspondances sont
// signalées À CONFIRMER, jamais retenues d'office — `SOUS_TRAITANCE.md` §2.7
// rappelle que deux graphies voisines peuvent désigner deux villes distinctes.
function normaliserSouple(nom: string): string {
  return normaliserVille(nom).replace(/[^a-z0-9]+/g, ' ').trim();
}

function distance(a: string, b: string): number {
  const ligne = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonale = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const haut = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonale + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonale = haut;
    }
  }
  return ligne[b.length];
}

// Pistes pour l'arbitrage humain, JAMAIS une décision : le rapprochement final
// d'une localité à un `cityId` se valide à la main. Deux signaux :
//   · l'INCLUSION d'un nom dans l'autre, mot entier — « taounate centre »
//     contient « taounate ». C'est le cas d'une localité que leur réseau livre
//     sous le nom de la ville voisine, qu'on veut voir en tête de liste ;
//   · la PROXIMITÉ d'écriture (distance d'édition rapportée à la longueur) —
//     « lhajeb » / « el hajeb », « boulmane » / « boulemane ».
function suggerer(notre: string, leurs: VilleMeta[]): { ville: VilleMeta; score: number }[] {
  const n = normaliserSouple(notre);
  const motsN = ` ${n} `;
  return leurs
    .map((ville) => {
      const l = normaliserSouple(ville.name);
      const inclus = l.length >= 3 && (motsN.includes(` ${l} `) || ` ${l} `.includes(motsN));
      const proche = 1 - distance(n, l) / Math.max(n.length, l.length, 1);
      return { ville, score: inclus ? Math.max(proche, 0.9) : proche };
    })
    .filter((s) => s.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function indexer(villes: VilleMeta[], cle: (nom: string) => string): Map<string, VilleMeta[]> {
  const index = new Map<string, VilleMeta[]>();
  for (const v of villes) {
    const k = cle(v.name);
    index.set(k, [...(index.get(k) ?? []), v]);
  }
  return index;
}

async function nosVillesMeta(): Promise<{ nom: string; agence: string; villeAgence: string }[]> {
  const agences = await prisma.hub.findMany({
    where: { prestataire: { nom: NOM_PRESTATAIRE } },
    select: { nom: true, ville: true, villes: { select: { nom: true }, orderBy: { nom: 'asc' } } },
    orderBy: { nom: 'asc' },
  });
  return agences.flatMap((a) => a.villes.map((v) => ({ nom: v.nom, agence: a.nom, villeAgence: a.ville })));
}

function rapprocher(notres: { nom: string; agence: string }[], leurs: VilleMeta[]): Rapprochement {
  const parStrict = indexer(leurs, normaliserVille);
  const parSouple = indexer(leurs, normaliserSouple);
  const r: Rapprochement = { strict: [], souple: [], ambigu: [], absent: [] };

  for (const n of notres) {
    const strict = parStrict.get(normaliserVille(n.nom)) ?? [];
    const souple = strict.length > 0 ? strict : (parSouple.get(normaliserSouple(n.nom)) ?? []);
    if (souple.length > 1) r.ambigu.push({ notre: n.nom, agence: n.agence, candidats: souple });
    else if (strict.length === 1) r.strict.push({ notre: n.nom, agence: n.agence, leur: strict[0] });
    else if (souple.length === 1) r.souple.push({ notre: n.nom, agence: n.agence, leur: souple[0] });
    else r.absent.push({ notre: n.nom, agence: n.agence });
  }
  return r;
}

async function reconnaitre(): Promise<void> {
  const ids = lireIdentifiants();
  console.log(`Meta Livraison — reconnaissance, lecture seule\nBase : ${ids.base}\n`);

  await appeler(ids, 'POST', '/api/v1/partner/auth');
  console.log('1. Branchement ........ OK (clé et secret acceptés)');

  const leurs = lireVilles(await appeler(ids, 'GET', '/api/v1/partner/cities'));
  console.log(`2. Leurs villes ....... ${leurs.length}`);

  const statuts = await appeler(ids, 'GET', '/api/v1/partner/statuses');
  console.log(`3. Leurs statuts ...... ${enTableau(statuts).length || '(format inattendu, voir brut)'}`);

  const notres = await nosVillesMeta();
  const nbAgences = new Set(notres.map((n) => n.agence)).size;
  console.log(`4. Nos villes Meta .... ${notres.length} sur ${nbAgences} agences\n`);

  const r = rapprocher(notres, leurs);
  console.log('Rapprochement des villes');
  console.log(`   ✔ exact ............ ${r.strict.length}`);
  console.log(`   ~ souple ........... ${r.souple.length}   (à confirmer)`);
  console.log(`   ? ambigu ........... ${r.ambigu.length}   (plusieurs candidats chez eux)`);
  console.log(`   ✘ sans équivalent .. ${r.absent.length}`);

  if (r.souple.length > 0) {
    console.log('\n~ Correspondances souples — à confirmer une par une');
    for (const s of r.souple) console.log(`   ${s.agence} · « ${s.notre} » → #${s.leur.id} « ${s.leur.name} »`);
  }
  if (r.ambigu.length > 0) {
    console.log('\n? Ambiguës');
    for (const a of r.ambigu) {
      const c = a.candidats.map((v) => `#${v.id} « ${v.name} »`).join(', ');
      console.log(`   ${a.agence} · « ${a.notre} » → ${c}`);
    }
  }
  if (r.absent.length > 0) {
    const avecPiste = r.absent.map((a) => ({ ...a, pistes: suggerer(a.notre, leurs) }));
    const sansPiste = avecPiste.filter((a) => a.pistes.length === 0);
    console.log(`\n✘ Sans équivalent exact — ${avecPiste.length - sansPiste.length} avec une piste, ${sansPiste.length} sans`);
    for (const a of avecPiste) {
      const pistes = a.pistes.map((p) => `#${p.ville.id} « ${p.ville.name} » ${Math.round(p.score * 100)} %`).join(' · ');
      console.log(`   ${a.agence} · « ${a.notre} »${pistes ? `  →  ${pistes}` : '  →  (aucune piste)'}`);
    }
  }

  // Leurs villes que notre référentiel Meta n'a pas : à connaître avant de
  // décider si un colis pour l'une d'elles peut leur être confié.
  const connues = new Set(r.strict.map((s) => s.leur.id));
  console.log(`\nLeurs villes absentes de notre référentiel Meta : ${leurs.length - connues.size} sur ${leurs.length}`);

  // Export complet pour préparer à la main le fichier de correspondances
  // (lib/meta-livraison-villes.ts). Écrit là où l'appelant le demande — à
  // mettre HORS du dépôt : leur référentiel n'a pas à y être versionné.
  const iExport = process.argv.indexOf('--export');
  if (iExport > 0 && process.argv[iExport + 1]) {
    const { writeFileSync } = await import('node:fs');
    const pistes = r.absent.map((a) => ({ ...a, pistes: suggerer(a.notre, leurs) }));
    writeFileSync(process.argv[iExport + 1], JSON.stringify({ leurs, notres, rapprochement: { ...r, absent: pistes } }, null, 2));
    console.log(`\nExport écrit : ${process.argv[iExport + 1]}`);
  }

  // Le catalogue n'est affiché en entier que sur demande : il ne change pas
  // d'un lancement à l'autre, et il noie le rapport des villes.
  if (process.argv.includes('--statuts')) {
    console.log('\nLeur catalogue de statuts (brut)');
    console.log(JSON.stringify(statuts, null, 2));
  }
}

if (lanceDirectement('reconnaitre-meta-livraison')) {
  lancerEnCli(reconnaitre);
}
