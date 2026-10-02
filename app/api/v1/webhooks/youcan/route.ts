import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { recevoirWebhookYoucan } from '@/lib/youcan';

// § Intégration YouCan — réception des webhooks (REST Hooks) des boutiques
// connectées par nos marchands (INTEGRATION_YOUCAN.md).
//
// ⚠️ SANS requireUser NI requirePermission, comme les webhooks Power Delivery
// et Shopify : c'est le serveur de YouCan qui appelle. Le contrôle d'accès est
// la signature HMAC-SHA256 hexadécimale (`X-YOUCAN-SIGNATURE`) du corps brut,
// calculée avec le secret de NOTRE application YouCan (YOUCAN_CLIENT_SECRET).
// L'exception est aussi écrite dans lib/permission-routes.ts.
//
// Route servie uniquement sur HOST_API (proxy.ts §1 bis). Les codes de
// réponse sont choisis par recevoirWebhookYoucan, qui documente leur effet.

const PLAFOND_IP = { max: 600, fenetreMs: 60_000 };

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request) ?? 'inconnue';
    const plafond = await checkRateLimit(`webhook-youcan-ip:${ip}`, PLAFOND_IP.max, PLAFOND_IP.fenetreMs);
    if (!plafond.allowed) {
      return NextResponse.json(
        { ok: false },
        { status: 429, headers: { 'Retry-After': String(plafond.retryAfterSeconds) } }
      );
    }

    // Les OCTETS reçus : la signature porte sur eux.
    const corpsBrut = Buffer.from(await request.arrayBuffer());
    const resultat = await recevoirWebhookYoucan({
      corpsBrut,
      signature: request.headers.get('x-youcan-signature'),
      sujet: request.headers.get('x-youcan-topic'),
      idLivraison: request.headers.get('x-youcan-delivery-id'),
    });
    return NextResponse.json({ ok: resultat.statut === 200 }, { status: resultat.statut });
  } catch (error) {
    console.error('Webhook YouCan :', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
