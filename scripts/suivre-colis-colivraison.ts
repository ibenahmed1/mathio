import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { actualiserColisColivraison } from '../lib/suivi-colivraison';
import { prestataireColivraison } from '../lib/remise-colivraison';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Suivi des colis confiés à Colivraison —
 *
 *   npx tsx scripts/suivre-colis-colivraison.ts          à blanc : liste ce qui serait interrogé
 *   npx tsx scripts/suivre-colis-colivraison.ts --oui    interroge et applique
 *   npx tsx scripts/suivre-colis-colivraison.ts --oui --forcer   toutes les remises actives
 *
 * POURQUOI IL EXISTE. Colivraison n'a PAS de webhook : sans ce script, un colis
 * livré chez eux ne le devient chez nous que si quelqu'un clique sur
 * « Actualiser ». Contrairement au rattrapage Power Delivery (une fois par
 * nuit), celui-ci est le canal PRINCIPAL : à planifier plusieurs fois par jour.
 *
 * À BLANC PAR DÉFAUT : il écrit de vrais statuts — dont « livré », qui est une
 * écriture d'argent.
 */

// Un colis interrogé il y a moins de 3 h n'est pas réinterrogé : leur suivi
// n'évolue pas à la minute, et leur API n'annonce aucun quota.
const INTERVALLE_MS = 3 * 60 * 60 * 1000;

async function executer(): Promise<void> {
  const appliquer = process.argv.includes('--oui');
  const forcer = process.argv.includes('--forcer');
  const colivraison = await prestataireColivraison();

  const fenetre = forcer
    ? {}
    : {
        OR: [
          { etat: 'a_confirmer' as const },
          { codeExterne: null },
          { dernierEvenementLe: null },
          { dernierEvenementLe: { lt: new Date(Date.now() - INTERVALLE_MS) } },
        ],
      };

  const remises = await prisma.remisePrestataire.findMany({
    where: {
      prestataireId: colivraison.id,
      active: true,
      ...fenetre,
      commande: { statut: { notIn: ['livre', 'retourne', 'annule_par_vendeur'] } },
    },
    select: { commandeId: true, codeEnvoye: true, etat: true, commande: { select: { statut: true } } },
    orderBy: { creeLe: 'asc' },
  });

  console.log(`Colivraison — suivi${appliquer ? '' : ' (à blanc)'}${forcer ? ' — toutes les remises actives' : ''}`);
  console.log(`${remises.length} colis à interroger\n`);

  if (!appliquer) {
    for (const r of remises) console.log(`   ${r.codeEnvoye}  ${r.etat}  (chez nous : ${r.commande.statut})`);
    if (remises.length > 0) console.log('\nRelancer avec --oui pour interroger leur suivi et appliquer.');
    return;
  }

  const bilan = new Map<string, number>();
  let echecs = 0;
  for (const r of remises) {
    try {
      const resultat = await actualiserColisColivraison(r.commandeId);
      bilan.set(resultat.issue, (bilan.get(resultat.issue) ?? 0) + 1);
      console.log(`   ${r.codeEnvoye}  → ${resultat.issue}${resultat.detail ? ` (${resultat.detail})` : ''}`);
    } catch (erreur) {
      echecs += 1;
      console.log(`   ${r.codeEnvoye}  ✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }

  console.log(`\nBilan : ${[...bilan].map(([issue, n]) => `${issue} ${n}`).join(' · ') || 'rien'}${echecs ? ` · échecs ${echecs}` : ''}`);
  if (echecs > 0) process.exitCode = 1;
}

if (lanceDirectement('suivre-colis-colivraison')) {
  lancerEnCli(executer);
}
