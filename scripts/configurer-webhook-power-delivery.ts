import 'dotenv/config';
import {
  ErreurPowerDelivery,
  configurerWebhookPower,
  lireWebhookPower,
  supprimerWebhookPower,
} from '../lib/power-delivery';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Configuration du webhook Power Delivery, CHEZ EUX —
 *
 *   npx tsx scripts/configurer-webhook-power-delivery.ts                  lit la configuration
 *   npx tsx scripts/configurer-webhook-power-delivery.ts --configurer <url>  l'enregistre
 *   npx tsx scripts/configurer-webhook-power-delivery.ts --supprimer        la supprime
 *
 * Un script et non un écran : c'est un geste unique par environnement, fait
 * par qui déploie. `<url>` est l'adresse PUBLIQUE de notre récepteur, sur
 * l'hôte de l'API machine : https://<HOST_API>/api/v1/webhooks/power-delivery.
 *
 * Le secret est lu dans POWERDELIVERY_WEBHOOK_SECRET et n'est JAMAIS affiché.
 * Il doit être le même ici et sur le serveur qui reçoit : c'est lui qui signe
 * leurs envois, et notre récepteur refuse tout webhook non signé — chez eux,
 * la signature est optionnelle ; chez nous, elle ne l'est pas.
 *
 * Tous les événements sont demandés (`["*"]`) : le tri entre ce qu'on applique
 * et ce qu'on mémorise se fait chez nous (lib/power-delivery-statuts.ts), où il
 * est testé — pas dans une liste de cases cochées chez eux, qui dériverait en
 * silence.
 */

// Leurs valeurs par défaut, reprises telles quelles.
const TENTATIVES = 3;
const DELAI_S = 10;
// Un secret court se devine ; leur documentation suggère 32 caractères.
const LONGUEUR_MIN_SECRET = 32;

async function executer(): Promise<void> {
  const args = process.argv.slice(2);

  try {
    if (args[0] === '--supprimer') {
      await supprimerWebhookPower();
      console.log('Configuration du webhook supprimée chez Power Delivery.');
      return;
    }

    if (args[0] === '--configurer') {
      const url = args[1]?.trim() ?? '';
      if (!/^https:\/\/[^\s]+\/api\/v1\/webhooks\/power-delivery$/.test(url)) {
        throw new Error('URL attendue : https://<hôte-api>/api/v1/webhooks/power-delivery');
      }
      const secret = process.env.POWERDELIVERY_WEBHOOK_SECRET?.trim() ?? '';
      if (secret.length < LONGUEUR_MIN_SECRET) {
        throw new Error(`POWERDELIVERY_WEBHOOK_SECRET absent ou plus court que ${LONGUEUR_MIN_SECRET} caractères`);
      }
      await configurerWebhookPower({ url, secret, events: ['*'], retry_count: TENTATIVES, timeout: DELAI_S });
      console.log(`Webhook configuré : ${url} — tous les événements, ${TENTATIVES} tentatives, ${DELAI_S} s.`);
      return;
    }

    // Leur GET renvoie la configuration SANS le secret ; on l'affiche telle
    // quelle.
    console.log(JSON.stringify(await lireWebhookPower(), null, 2));
  } catch (erreur) {
    if (erreur instanceof ErreurPowerDelivery) throw new Error(erreur.message);
    throw erreur;
  }
}

if (lanceDirectement('configurer-webhook-power-delivery')) {
  lancerEnCli(executer);
}
