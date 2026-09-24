import 'dotenv/config';
import {
  ErreurColisEstLivraison,
  ErreurEstLivraison,
  construireCommandeEst,
  creerCommandeEst,
  type ColisAConfier,
} from '../lib/est-livraison';
import { resoudreVilleEst } from '../lib/est-livraison-villes';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Dépôt d'un colis de TEST chez EST Livraison, par notre propre client —
 * `npx tsx scripts/tester-remise-est-livraison.ts` (à blanc),
 * `npx tsx scripts/tester-remise-est-livraison.ts --oui` (dépose vraiment).
 *
 * À BLANC PAR DÉFAUT, et c'est délibéré : un dépôt accepté est un vrai
 * ramassage chez eux, et leur API n'a AUCUNE route d'annulation qui fonctionne
 * (INTEGRATION_EST_LIVRAISON.md §3.2). Ce qui part ne se reprend pas depuis
 * chez nous : il faut le leur demander à la main. La commande la plus
 * irréversible du module ne doit pas être celle qu'on tape le plus facilement.
 *
 * Il ne touche PAS la base : aucune `RemisePrestataire` n'est écrite, aucun
 * colis réel n'est lu. Il n'exerce qu'une chose, mais de bout en bout : notre
 * construction du corps et notre lecture de leur réponse, contre leur vrai
 * serveur. C'est ce que les tests unitaires, qui parlent à un faux `fetch`, ne
 * peuvent pas prouver.
 *
 * Le colis est marqué comme tel — nom, adresse et note le disent — pour qu'un
 * humain chez eux le reconnaisse immédiatement et ne l'envoie pas en tournée.
 */

// Notre numérotation réelle est `VIL-XXXXXX-JJMMAA` (§ NUMERO_SERIE_QR_CODEBARRE.md).
// Ce code n'en a pas la forme, exprès : il ne doit se confondre avec aucun colis.
function codeDeTest(): string {
  const horodatage = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `MATHIO-TEST-${horodatage}`;
}

// La seule ville dont le libellé chez eux soit vérifié.
const VILLE_NOTRE = 'Oujda (Centre & Quartiers)';
const AGENCE = 'Agence Oujda';

function colisDeTest(code: string): ColisAConfier {
  return {
    codeSuivi: code,
    clientNom: 'TEST MATHIO — NE PAS LIVRER',
    // Notre numéro, pour qu'un appel de leur part tombe chez nous et non chez
    // un inconnu tiré au hasard.
    clientTelephone: '0600000000',
    adresse: 'COLIS DE TEST — NE PAS METTRE EN TOURNÉE',
    // Zéro est ici une VALEUR : un colis de test n'encaisse rien. Le champ part
    // quand même, parce que l'omettre laisserait leur défaut décider.
    montantCod: 0,
    ouvrir: false,
    fragile: false,
    aRemplacer: false,
    produitDescription: 'Test d’intégration API',
    quantite: 1,
  };
}

export async function testerRemiseEstLivraison(): Promise<void> {
  const pourDeVrai = process.argv.includes('--oui');
  const code = codeDeTest();

  const ville = resoudreVilleEst(AGENCE, VILLE_NOTRE);
  if (!ville) {
    console.log(`✘ « ${VILLE_NOTRE} » n'a pas de correspondance EST Livraison.`);
    console.log('  Rien n’est envoyé : envoyer un nom non vérifié créerait une ville chez eux.');
    process.exitCode = 1;
    return;
  }

  let commande;
  try {
    commande = construireCommandeEst(colisDeTest(code), ville.nomEst);
  } catch (erreur) {
    if (!(erreur instanceof ErreurColisEstLivraison)) throw erreur;
    console.log(`✘ Colis refusé avant tout appel : ${erreur.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Ville  : « ${VILLE_NOTRE} » → « ${ville.nomEst} » (${ville.groupe})`);
  console.log('Corps  :');
  console.log(JSON.stringify(commande, null, 2).replace(/^/gm, '  '));

  if (!pourDeVrai) {
    console.log('\nÀ BLANC — rien n’a été envoyé.');
    console.log('Relancer avec --oui pour déposer réellement. ⚠️ Le dépôt est IRRÉVERSIBLE :');
    console.log('leur route d’annulation n’existe pas, il faudra leur demander de le retirer.');
    return;
  }

  console.log('\nDépôt réel chez EST Livraison…\n');
  try {
    const creation = await creerCommandeEst(commande);
    console.log('✔ ACCEPTÉ.');
    console.log(`  Code envoyé ........ ${commande.code}`);
    console.log(`  Leur identifiant ... ${creation.idExterne ?? '(aucun)'}`);
    console.log('  Réponse brute :');
    console.log(JSON.stringify(creation.brut, null, 2).replace(/^/gm, '    '));
    console.log('\n⚠️ Ce colis existe maintenant chez eux. Leur demander de le retirer.');
  } catch (erreur) {
    if (!(erreur instanceof ErreurEstLivraison)) throw erreur;
    console.log('✘ REFUSÉ.');
    console.log(`  ${erreur.message}`);
    if (erreur.brut !== null) console.log(`  Brut : ${JSON.stringify(erreur.brut)}`);
    process.exitCode = 1;
  }
}

if (lanceDirectement('tester-remise-est-livraison')) {
  lancerEnCli(testerRemiseEstLivraison);
}
