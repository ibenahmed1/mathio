import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { actualiserColisPower } from '../lib/actions-power-delivery';
import { prestatairePower } from '../lib/remise-power-delivery';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Rattrapage du suivi Power Delivery —
 *
 *   npx tsx scripts/suivre-colis-power-delivery.ts          à blanc : liste ce qui serait interrogé
 *   npx tsx scripts/suivre-colis-power-delivery.ts --oui    interroge et applique
 *
 * POURQUOI IL EXISTE. Leurs webhooks ne sont réessayés que trois fois : une
 * coupure de quelques minutes chez nous, et un « livré » est perdu pour de bon.
 * Ce script interroge leur suivi (`trackparcel`) pour chaque colis confié dont
 * on est sans nouvelles depuis 24 h, et applique ce qu'il dit par la même règle
 * que les webhooks (lib/suivi-power-delivery.ts). Il rattrape aussi les remises
 * restées `a_confirmer` après un appel de création sans réponse.
 *
 * À BLANC PAR DÉFAUT : il écrit de vrais statuts — dont « livré », qui est une
 * écriture d'argent — et la commande la plus facile à taper ne doit pas être
 * celle qui en écrit. À planifier une fois par nuit avec `--oui`.
 *
 * Un colis après l'autre : leur API n'annonce aucun quota, et interroger en
 * parallèle ce qu'on n'a pas besoin de savoir à la seconde n'apporte rien.
 */

const SANS_NOUVELLES_MS = 24 * 60 * 60 * 1000;
// Une remise toute fraîche n'a pas encore eu le temps de recevoir un webhook.
const DELAI_DE_GRACE_MS = 60 * 60 * 1000;

async function executer(): Promise<void> {
  const appliquer = process.argv.includes('--oui');
  const power = await prestatairePower();
  const maintenant = Date.now();

  const remises = await prisma.remisePrestataire.findMany({
    where: {
      prestataireId: power.id,
      active: true,
      creeLe: { lt: new Date(maintenant - DELAI_DE_GRACE_MS) },
      OR: [
        { etat: 'a_confirmer' },
        { dernierEvenementLe: null },
        { dernierEvenementLe: { lt: new Date(maintenant - SANS_NOUVELLES_MS) } },
      ],
      // Un colis clos chez nous n'a plus rien à apprendre de leur suivi.
      commande: { statut: { notIn: ['livre', 'retourne', 'annule_par_vendeur'] } },
    },
    select: { commandeId: true, codeEnvoye: true, etat: true, commande: { select: { statut: true } } },
    orderBy: { creeLe: 'asc' },
  });

  console.log(`Power Delivery — rattrapage du suivi${appliquer ? '' : ' (à blanc)'}`);
  console.log(`${remises.length} colis sans nouvelles depuis 24 h ou à confirmer\n`);

  if (!appliquer) {
    for (const r of remises) console.log(`   ${r.codeEnvoye}  ${r.etat}  (chez nous : ${r.commande.statut})`);
    if (remises.length > 0) console.log('\nRelancer avec --oui pour interroger leur suivi et appliquer.');
    return;
  }

  const bilan = new Map<string, number>();
  let echecs = 0;
  for (const r of remises) {
    try {
      const resultat = await actualiserColisPower(r.commandeId);
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

if (lanceDirectement('suivre-colis-power-delivery')) {
  lancerEnCli(executer);
}
