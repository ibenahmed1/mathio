import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { listerVillesColivraison } from '../lib/colivraison';
import { normaliserVille } from '../lib/hub-stock';
import {
  CORRESPONDANCES_VILLES_COLIVRAISON,
  VILLES_COLIVRAISON_SANS_CORRESPONDANCE,
} from '../lib/colivraison-villes';
import { NOM_PRESTATAIRE_COLIVRAISON } from '../lib/remise-colivraison';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Contrôle, en LECTURE SEULE, de la table lib/colivraison-villes.ts —
 *
 *   npx tsx scripts/verifier-villes-colivraison.ts
 *
 * Trois écarts possibles, chacun bloquant une remise juste :
 *   · une ville Colivraison du référentiel sans sort décidé (ni correspondance,
 *     ni mise de côté) ;
 *   · une correspondance dont l'identifiant n'existe plus chez eux, ou dont le
 *     nom a changé — c'est le NOM qu'on leur envoie ;
 *   · une correspondance vers une ville qui n'est plus dans le référentiel.
 * Sortie 1 au moindre écart.
 */

async function executer(): Promise<void> {
  const leurs = new Map((await listerVillesColivraison()).map((v) => [v.id, v.nom]));
  const ecarts: string[] = [];

  for (const c of CORRESPONDANCES_VILLES_COLIVRAISON) {
    const nom = leurs.get(c.cityId);
    if (!nom) ecarts.push(`${c.agence} · ${c.ville} : #${c.cityId} n'existe plus chez eux`);
    else if (nom !== c.nomColivraison) ecarts.push(`${c.agence} · ${c.ville} : #${c.cityId} s'appelle « ${nom} », pas « ${c.nomColivraison} »`);
  }

  const villes = await prisma.ville.findMany({
    where: { hub: { prestataire: { nom: NOM_PRESTATAIRE_COLIVRAISON } } },
    select: { nom: true, hub: { select: { nom: true } } },
  });
  const cle = (agence: string, ville: string) => `${agence}|${normaliserVille(ville)}`;
  const enBase = new Set(villes.map((v) => cle(v.hub.nom, v.nom)));
  const decidees = new Set(
    [...CORRESPONDANCES_VILLES_COLIVRAISON, ...VILLES_COLIVRAISON_SANS_CORRESPONDANCE].map((c) => cle(c.agence, c.ville))
  );
  for (const v of villes) {
    if (!decidees.has(cle(v.hub.nom, v.nom))) ecarts.push(`${v.hub.nom} · ${v.nom} : aucun sort décidé dans lib/colivraison-villes.ts`);
  }
  for (const c of CORRESPONDANCES_VILLES_COLIVRAISON) {
    if (!enBase.has(cle(c.agence, c.ville))) ecarts.push(`${c.agence} · ${c.ville} : absente du référentiel`);
  }

  console.log(`${villes.length} villes Colivraison en base · ${CORRESPONDANCES_VILLES_COLIVRAISON.length} correspondances · ${VILLES_COLIVRAISON_SANS_CORRESPONDANCE.length} mises de côté · ${leurs.size} villes chez eux`);
  if (ecarts.length === 0) {
    console.log('Aucun écart.');
    return;
  }
  console.log(`\n${ecarts.length} écart(s) :`);
  for (const e of ecarts) console.log(`   ${e}`);
  process.exitCode = 1;
}

if (lanceDirectement('verifier-villes-colivraison')) {
  lancerEnCli(executer);
}
