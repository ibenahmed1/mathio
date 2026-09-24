import 'dotenv/config';
import { ErreurEstLivraison, supprimerCommandesEst } from '../lib/est-livraison';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Vérifie que notre `Client-Key` est acceptée par EST Livraison —
 * `npx tsx scripts/verifier-cle-est-livraison.ts`.
 *
 * NE CRÉE NI NE SUPPRIME RIEN, et c'est toute la subtilité du script.
 *
 * Leur API n'expose AUCUNE lecture : ni `ping`, ni `whoami`, ni liste de
 * villes, ni suivi. Le seul appel qui ne modifie rien est donc une SUPPRESSION
 * portant un code qui n'existe pas : il n'y a rien à supprimer, et leur
 * validation répond quand même. Une création, elle, déclencherait un vrai
 * ramassage — c'est exactement ce qu'on ne veut pas pour un test.
 *
 * Trois réponses possibles, et les trois renseignent :
 *
 *   · 400 « not found » ... la clé est ACCEPTÉE. L'hôte, le chemin (avec sa
 *     faute de frappe), l'en-tête et la clé sont tous bons : leur serveur est
 *     allé jusqu'à chercher le code. C'est le succès.
 *   · 401 .................. la clé est refusée, révoquée, ou l'en-tête n'est
 *     pas celui que leur serveur attend réellement.
 *   · aucune réponse ....... leur hôte est injoignable depuis cette machine.
 *
 * Un 200 serait le seul cas préoccupant : il voudrait dire qu'ils ont trouvé —
 * et donc supprimé — quelque chose sous ce code. Le script le signale comme une
 * anomalie plutôt que comme un succès.
 *
 * La clé n'est JAMAIS affichée, ni en cas de succès ni en erreur.
 */

// Un code qui ne peut appartenir à aucun colis : notre numérotation est
// `VIL-XXXXXX-JJMMAA` (§ NUMERO_SERIE_QR_CODEBARRE.md), jamais cette forme-là.
const CODE_INEXISTANT = 'MATHIO-VERIFICATION-CLE-NE-PAS-UTILISER';

export async function verifierCleEstLivraison(): Promise<void> {
  const base = process.env.EST_LIVRAISON_BASE_URL?.trim() || 'https://pb.estlivraison.com';
  console.log(`EST Livraison — vérification de la clé sur ${base}`);
  console.log(`Appel : suppression du code « ${CODE_INEXISTANT} », qui n'existe pas.\n`);

  try {
    const resultat = await supprimerCommandesEst([CODE_INEXISTANT]);
    // Ils ont répondu « supprimé » sur un code que nous n'avons jamais créé.
    console.log('⚠ Leur API a répondu un SUCCÈS à la suppression d’un code inexistant.');
    console.log(`  Codes qu’ils disent avoir supprimés : ${resultat.codesSupprimes.join(', ') || '(aucun)'}`);
    console.log('  La clé fonctionne, mais leur comportement ne suit pas leur documentation :');
    console.log('  à leur signaler avant de leur confier un colis.');
    process.exitCode = 1;
    return;
  } catch (erreur) {
    if (!(erreur instanceof ErreurEstLivraison)) throw erreur;

    if (erreur.statutHttp === 401) {
      console.log('✘ CLÉ REFUSÉE (401).');
      console.log(`  Leur message : ${erreur.message}`);
      console.log('  Vérifier EST_LIVRAISON_CLE dans .env, ou leur demander si elle a été révoquée.');
      process.exitCode = 1;
      return;
    }

    if (erreur.statutHttp === 400) {
      console.log('✔ CLÉ ACCEPTÉE.');
      console.log(`  Leur message : ${erreur.message}`);
      console.log('\n  Ce que ce 400 prouve : leur serveur a authentifié la clé, puis cherché le');
      console.log('  code et ne l’a pas trouvé. L’hôte, le chemin et l’en-tête sont donc corrects.');
      return;
    }

    if (erreur.statutHttp === null) {
      console.log('✘ INJOIGNABLE.');
      console.log(`  ${erreur.message}`);
      console.log('  Rien ne dit que la clé est mauvaise : leur hôte n’a pas répondu.');
      process.exitCode = 1;
      return;
    }

    console.log(`✘ Réponse inattendue (HTTP ${erreur.statutHttp}).`);
    console.log(`  ${erreur.message}`);
    process.exitCode = 1;
  }
}

if (lanceDirectement('verifier-cle-est-livraison')) {
  lancerEnCli(verifierCleEstLivraison);
}
