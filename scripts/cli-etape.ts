import { basename, extname } from 'node:path';
import { prisma } from '../lib/prisma';

/**
 * Outillage commun aux scripts du référentiel, depuis qu'ils sont à la fois des
 * commandes autonomes ET des étapes appelées par `scripts/charger-referentiel.ts`
 * (lui-même appelé par le seed).
 *
 * Le problème que ça résout : un script qui exécute son `main()` au chargement
 * du module le ré-exécute au moment où un autre fichier l'IMPORTE. Sans le
 * garde ci-dessous, importer les sept imports pour les enchaîner les lancerait
 * tous les sept à l'import, dans l'ordre des `import`, avant la moindre
 * vérification — et deux fois au total.
 */

/**
 * Vrai quand le fichier appelant est le point d'entrée de `tsx`, faux quand il
 * est simplement importé.
 *
 * Comparaison sur le NOM DE BASE de `process.argv[1]`, et non sur
 * `import.meta.url` : le dépôt n'a pas de `"type": "module"` dans son
 * `package.json`, donc tsx traite ces `.ts` comme du CommonJS, où `import.meta`
 * n'existe pas. Le nom de base est aussi insensible aux différences de
 * séparateur entre Windows et Linux, ce qui compte ici : ces scripts sont
 * écrits sous Windows et exécutés sur le serveur de déploiement.
 *
 * Le nom est passé en clair par l'appelant plutôt que déduit : en CommonJS il
 * n'y a pas de moyen portable pour un module de connaître son propre chemin
 * sous tsx sans dépendre de `__filename`, que la compilation ES module ne
 * fournit pas. Conséquence à connaître : renommer un de ces fichiers sans
 * changer la chaîne le rend muet en ligne de commande — il s'importera
 * toujours, mais ne se lancera plus seul.
 */
export function lanceDirectement(nomFichierSansExtension: string): boolean {
  const entree = process.argv[1];
  if (!entree) return false;
  return basename(entree, extname(entree)) === nomFichierSansExtension;
}

/**
 * Lance une étape en ligne de commande : même traitement d'erreur et même
 * fermeture de connexion pour les huit scripts.
 *
 * La connexion n'est fermée QUE sur ce chemin. Une étape appelée depuis
 * `chargerReferentiel()` ne doit pas fermer le client sous les pieds de la
 * suivante — c'est l'appelant le plus haut qui en a la responsabilité.
 */
export function lancerEnCli(etape: () => Promise<void>): void {
  etape()
    .catch((erreur) => {
      console.error(erreur);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
