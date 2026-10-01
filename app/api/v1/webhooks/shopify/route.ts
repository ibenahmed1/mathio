import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { recevoirWebhookShopify } from '@/lib/shopify';

// § Intégration Shopify — réception des webhooks `orders/create` des boutiques
// connectées par nos marchands (INTEGRATION_SHOPIFY.md).
//
// ⚠️ SANS requireUser NI requirePermission, comme le webhook Power Delivery et
// pour la même raison : c'est le serveur de Shopify qui appelle, sans session
// ni clé à nous. Le contrôle d'accès est la signature HMAC-SHA256
// (`X-Shopify-Hmac-Sha256`) du corps brut, calculée avec la clé secrète de LA
// boutique désignée par `X-Shopify-Shop-Domain` — une boutique inconnue ou
// déconnectée n'a pas de clé, donc est refusée. L'exception est aussi écrite
// dans lib/permission-routes.ts, là où on la cherche.
//
// Cette route n'existe que sur l'hôte de l'API machine (HOST_API) : le proxy
// renvoie 404 sur `/api/v1/**` partout ailleurs (proxy.ts §1 bis). Les codes
// de réponse sont choisis par lib/shopify.ts (recevoirWebhookShopify), qui
// documente leur effet sur les tentatives de Shopify.

// Plafond par IP, appliqué avant toute lecture de corps. Les webhooks Shopify
// partent d'un pool d'adresses partagé entre toutes les boutiques : le plafond
// est donc large, et vise la saturation, pas le trafic d'une boutique.
const PLAFOND_IP = { max: 600, fenetreMs: 60_000 };

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request) ?? 'inconnue';
    const plafond = await checkRateLimit(`webhook-shopify-ip:${ip}`, PLAFOND_IP.max, PLAFOND_IP.fenetreMs);
    if (!plafond.allowed) {
      return NextResponse.json(
        { ok: false },
        { status: 429, headers: { 'Retry-After': String(plafond.retryAfterSeconds) } }
      );
    }

    // Les OCTETS reçus, et non `request.text()` : la signature porte sur eux,
    // et rien ne doit s'interposer entre la réception et le calcul.
    const corpsBrut = Buffer.from(await request.arrayBuffer());

    const resultat = await recevoirWebhookShopify({
      corpsBrut,
      domaine: request.headers.get('x-shopify-shop-domain'),
      signature: request.headers.get('x-shopify-hmac-sha256'),
      sujet: request.headers.get('x-shopify-topic'),
      idWebhook: request.headers.get('x-shopify-webhook-id'),
    });

    // Corps minimal : Shopify n'en lit rien, et un tiers qui sonde la route
    // n'a pas à apprendre si une boutique existe chez nous.
    return NextResponse.json({ ok: resultat.statut === 200 }, { status: resultat.statut });
  } catch (error) {
    console.error('Webhook Shopify :', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
