import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import {
  CORRESPONDANCES_VILLES_POWER,
  VILLES_POWER_SANS_CORRESPONDANCE,
} from '../lib/power-delivery-villes';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Contrôle des villes Power Delivery contre leur API réelle —
 * `npx tsx scripts/verifier-villes-power-delivery.ts`.
 *
 * STRICTEMENT EN LECTURE, des deux côtés. Chez eux : `GET listcities`, qui ne
 * crée rien. Chez nous : les villes rattachées aux agences Power. Aucun colis
 * n'est créé chez eux, aucune ligne n'est écrite chez nous.
 *
 * Il existe parce que lib/power-delivery-villes.ts est un relevé DATÉ : leur
 * liste peut bouger (une ville renommée, un identifiant retiré, une ville
 * ajoutée) sans que rien ne nous prévienne, et la première remise ratée serait
 * le seul signal. Trois questions, trois échecs possibles :
 *
 *   1. chaque identifiant retenu existe-t-il encore, sous le même nom ?
 *   2. une ville mise de côté est-elle apparue chez eux ? (bonne nouvelle, mais
 *      il faut la rapprocher À LA MAIN — ce script ne décide rien) ;
 *   3. toutes nos villes Power, TELLES QU'EN BASE, ont-elles un sort décidé ?
 *      Une ville ajoutée ou renommée depuis /admin/hubs n'est dans aucune des
 *      deux listes, et serait refusée à la remise sans que personne sache
 *      pourquoi.
 *
 * Code de sortie non nul au moindre écart : utilisable tel quel dans une tâche
 * planifiée. Le token n'est JAMAIS affiché, ni en cas de succès ni en erreur.
 */

const URL_VILLES = 'https://elog.ma/apiclient/listcities';
const NOM_PRESTATAIRE = 'Power Delivery';
const DELAI_MS = 20_000;

interface VillePower {
  id: number;
  city: string;
}

async function listerLeursVilles(): Promise<VillePower[]> {
  const token = process.env.POWERDELIVERY_TOKEN?.trim() ?? '';
  if (!token) throw new Error('Variable absente ou vide dans .env : POWERDELIVERY_TOKEN');

  // `Authorization` porte le token nu : `listcities` l'accepte, comme les
  // routes colis (vérifié le 23/09/2026 contre leur production, où il répond
  // 200 sous les deux formes). Seuls leurs chemins `/files/*` exigent
  // « Bearer » — voir `entete` dans lib/power-delivery.ts.
  const reponse = await fetch(URL_VILLES, {
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!reponse.ok) throw new Error(`GET listcities → HTTP ${reponse.status}`);

  // Leur documentation annonce un tableau nu ; l'API réelle répond
  // `{ success, data, total }`. On accepte les deux plutôt que de dépendre de
  // celle des deux qui a raison aujourd'hui.
  const corps = (await reponse.json()) as unknown;
  const brut = Array.isArray(corps) ? corps : (corps as { data?: unknown })?.data;
  if (!Array.isArray(brut)) throw new Error('GET listcities → format de réponse inattendu');

  return brut.flatMap((v) => {
    const { id, city } = (v ?? {}) as Record<string, unknown>;
    const idNum = typeof id === 'number' ? id : Number(id);
    return Number.isInteger(idNum) && typeof city === 'string' ? [{ id: idNum, city }] : [];
  });
}

async function verifier(): Promise<void> {
  console.log('Power Delivery — contrôle des villes, lecture seule\n');

  const leurs = await listerLeursVilles();
  const parId = new Map(leurs.map((v) => [v.id, v]));
  const occurrences = new Map<string, number>();
  for (const v of leurs) {
    const nom = normaliserVille(v.city);
    occurrences.set(nom, (occurrences.get(nom) ?? 0) + 1);
  }
  console.log(`Leurs villes .......... ${leurs.length}`);

  const agences = await prisma.hub.findMany({
    where: { prestataire: { nom: NOM_PRESTATAIRE } },
    select: { nom: true, villes: { select: { nom: true } } },
  });
  const nosVilles = agences.flatMap((a) => a.villes.map((v) => ({ agence: a.nom, ville: v.nom })));
  console.log(`Nos villes Power ...... ${nosVilles.length}\n`);

  const ecarts: string[] = [];

  // 1. Les identifiants retenus existent toujours, sous le même nom.
  for (const c of CORRESPONDANCES_VILLES_POWER) {
    const chezEux = parId.get(c.cityId);
    if (!chezEux) {
      ecarts.push(`#${c.cityId} (« ${c.ville} », ${c.agence}) n'existe plus chez eux`);
    } else if (normaliserVille(chezEux.city) !== normaliserVille(c.nomPower)) {
      ecarts.push(`#${c.cityId} s'appelle désormais « ${chezEux.city.trim()} » (relevé : « ${c.nomPower} »)`);
    }
  }

  // 2. Une ville mise de côté devenue rapprochable : présente UNE fois chez eux
  // sous son nom exact. Deux fois ou plus, elle reste ambiguë — c'est le cas
  // d'« ouargui », mise de côté pour ses deux identifiants et non pour son
  // absence.
  for (const v of VILLES_POWER_SANS_CORRESPONDANCE) {
    if (occurrences.get(normaliserVille(v.ville)) === 1) {
      ecarts.push(`« ${v.ville} » (${v.agence}) existe désormais chez eux : à rapprocher à la main`);
    }
  }

  // 3. Toutes nos villes Power, telles qu'en base, ont un sort décidé.
  const decidees = new Set(
    [...CORRESPONDANCES_VILLES_POWER, ...VILLES_POWER_SANS_CORRESPONDANCE].map(
      (c) => `${c.agence}|${normaliserVille(c.ville)}`
    )
  );
  for (const v of nosVilles) {
    if (!decidees.has(`${v.agence}|${normaliserVille(v.ville)}`)) {
      ecarts.push(`« ${v.ville} » (${v.agence}) est en base mais dans aucune liste de lib/power-delivery-villes.ts`);
    }
  }

  console.log(`✔ identifiants retenus ... ${CORRESPONDANCES_VILLES_POWER.length}`);
  console.log(`· villes mises de côté .... ${VILLES_POWER_SANS_CORRESPONDANCE.length}`);

  if (ecarts.length > 0) {
    console.log(`\n✘ ${ecarts.length} écart(s)`);
    for (const e of ecarts) console.log(`   ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAucun écart.');
}

if (lanceDirectement('verifier-villes-power-delivery')) {
  lancerEnCli(verifier);
}
