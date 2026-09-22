import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  analyserWebhookPower,
  horodatagePerime,
  journaliserRejetWebhook,
  signatureValide,
  traiterInformationPower,
} from '@/lib/suivi-power-delivery';

// § Power Delivery — réception de leurs webhooks (changements de statut).
//
// ⚠️ SEULE ROUTE DU DÉPÔT SANS requireUser NI requirePermission, et ce n'est pas
// un oubli : c'est LEUR serveur qui appelle, sans session et sans clé à nous.
// Le contrôle d'accès est la signature HMAC-SHA256 du corps, obligatoire, plus
// une fenêtre de fraîcheur (lib/suivi-power-delivery.ts). L'exception est aussi
// écrite dans lib/permission-routes.ts, là où on la cherche.
//
// Cette route n'existe que sur l'hôte de l'API machine (HOST_API) : le proxy
// renvoie 404 sur `/api/v1/**` partout ailleurs (proxy.ts §1 bis).
//
// LES CODES DE RÉPONSE PILOTENT LEURS TENTATIVES — trois au plus, de leur
// côté. On ne répond une erreur que quand réessayer peut servir :
//   · 401 : signature invalide — c'est à eux de corriger leur secret ;
//   · 400 : horodatage périmé ou corps illisible ;
//   · 200 : tout ce qui a été lu, y compris un colis inconnu ou un statut
//           refusé — le rejouer ne changerait rien ;
//   · 500 : une panne chez nous (via le catch), pour qu'ils réessaient.

// Plafond par IP, appliqué avant toute lecture de corps : même principe que
// l'API des plateformes (PLAFOND_IP, lib/plateforme-auth.ts). Largement au-dessus
// d'un flux réel de webhooks, bien en dessous d'une tentative de saturation.
const PLAFOND_IP = { max: 300, fenetreMs: 60_000 };

function reponse(statut: number, corps: Record<string, unknown>): NextResponse {
  return NextResponse.json(corps, { status: statut });
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request) ?? 'inconnue';
    const plafond = await checkRateLimit(`webhook-power-ip:${ip}`, PLAFOND_IP.max, PLAFOND_IP.fenetreMs);
    if (!plafond.allowed) {
      return NextResponse.json(
        { success: false, error: 'Trop de requêtes' },
        { status: 429, headers: { 'Retry-After': String(plafond.retryAfterSeconds) } }
      );
    }

    // Le corps BRUT, tel que reçu : la signature porte sur ces octets-là, et un
    // JSON reparsé puis resérialisé ne les reproduirait pas.
    const corpsBrut = await request.text();
    const secret = process.env.POWERDELIVERY_WEBHOOK_SECRET?.trim() ?? '';
    const signee = signatureValide(corpsBrut, request.headers.get('x-webhook-signature'), secret);

    let corps: unknown = null;
    try {
      corps = JSON.parse(corpsBrut) as unknown;
    } catch {
      corps = null;
    }

    if (!signee) {
      // Ni lecture ni recherche de colis : seulement une trace, pour qu'une
      // falsification ou un secret mal configuré se voie. Le détail ne dit pas
      // lequel des deux, pas plus que la réponse.
      await journaliserRejetWebhook(corps ?? corpsBrut.slice(0, 2000), false, 'signature_invalide', secret
        ? 'Signature absente ou fausse'
        : 'POWERDELIVERY_WEBHOOK_SECRET non configuré');
      return reponse(401, { success: false, error: 'Signature invalide' });
    }

    const webhook = analyserWebhookPower(corps);
    if (!webhook) {
      await journaliserRejetWebhook(corps ?? corpsBrut.slice(0, 2000), true, 'corps_invalide', 'Payload illisible');
      return reponse(400, { success: false, error: 'Payload illisible' });
    }

    if (horodatagePerime(webhook.timestamp, new Date())) {
      await journaliserRejetWebhook(corps, true, 'perime', `timestamp ${webhook.timestamp} hors fenêtre`);
      return reponse(400, { success: false, error: 'Horodatage hors fenêtre' });
    }

    const resultat = await traiterInformationPower({
      source: 'webhook',
      code: webhook.code,
      statut: webhook.statut,
      statutSecond: webhook.statutSecond,
      paiement: webhook.paiement,
      charge: corps,
      signatureValide: true,
    });

    return reponse(200, { success: true, issue: resultat.issue });
  } catch (error) {
    // Rien de l'interne ne sort : un message générique, et un 500 pour qu'ils
    // réessaient.
    console.error('Webhook Power Delivery :', error);
    return reponse(500, { success: false, error: 'Erreur interne' });
  }
}
