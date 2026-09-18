import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { purgerJournalAppels } from '../lib/plateformes';

/**
 * Purge du journal des appels reçus (§ JournalAppelApi).
 *
 *   npm run purger:journal              30 jours, à blanc
 *   npm run purger:journal -- 30 --oui  30 jours, pour de vrai
 *   npm run purger:journal -- 7 --oui
 *
 * À BLANC PAR DÉFAUT, et c'est délibéré : une purge est irréversible, et la
 * commande la plus dangereuse du dépôt ne doit pas être celle qu'on tape le
 * plus facilement. Rien n'est supprimé sans `--oui`.
 *
 * À brancher sur une tâche planifiée une fois la fenêtre choisie.
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pourDeVrai = args.includes('--oui');
  const jours = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);

  const r = await purgerJournalAppels(jours, !pourDeVrai);

  console.log(`\nJournal des appels — fenêtre de ${r.joursConserves} jours`);
  if (pourDeVrai) {
    console.log(`  ${r.supprimes} ligne(s) supprimée(s)`);
  } else {
    console.log(`  ${r.supprimes} ligne(s) SERAIENT supprimées  (essai à blanc)`);
    console.log('  Relancer avec --oui pour exécuter.');
  }
  console.log(`  ${r.restants} ligne(s) conservée(s)`);
  console.log(
    `  plus ancienne conservée : ${r.plusAncienRestant?.toLocaleString('fr-FR') ?? '—'}\n`
  );
}

main()
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
