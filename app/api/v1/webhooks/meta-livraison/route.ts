import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { analyserEvenementMeta, signatureMetaValide } from '@/lib/meta-livraison-statuts';
import { journaliserRejetWebhookMeta, traiterInformationMeta } from '@/lib/suivi-meta-livraison';

// § Meta Livraison — réception de leurs webhooks `parcel.status.updated`.
//
// ⚠️ ROUTE SANS requireUser NI requirePermission, comme le webhook Power
// Delivery : c'est LEUR serveur qui appelle. Le contrôle d'accès est la
// signature HMAC-SHA256 du corps brut (`X-MetaLivraison-Signature`), vérifiée
// avec META_LIVRAISON_WEBHOOK_SECRET ; sans secret, tout est refusé. L'exception
// est aussi écrite dans lib/permission-routes.ts.
//
// Pas de fenêtre de fraîcheur : leur charge ne porte que la date de
// l'ÉVÉNEMENT (`occurredAt`), pas celle de l'envoi, et leurs nouvelles
// tentatives la conservent. Un rejeu signé retombe sur « inchangé ».
//
// Cette route n'existe que sur l'hôte de l'API machine (HOST_API).
//
// CODES DE RÉPONSE : 401 signature invalide, 400 corps illisible, 200 tout ce
// qui a été lu (y compris colis inconnu ou statut refusé), 500 panne chez nous.

const PLAFOND_IP = { max: 300, fenetreMs: 60_000 };

function reponse(statut: number, corps: Record<string, unknown>): NextResponse {
  return NextResponse.json(corps, { status: statut });
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request) ?? 'inconnue';
    const plafond = await checkRateLimit(`webhook-meta-ip:${ip}`, PLAFOND_IP.max, PLAFOND_IP.fenetreMs);
    if (!plafond.allowed) {
      return NextResponse.json(
        { success: false, error: 'Trop de requêtes' },
        { status: 429, headers: { 'Retry-After': String(plafond.retryAfterSeconds) } }
      );
    }

    // Le corps BRUT : la signature porte sur ces octets-là.
    const corpsBrut = await request.text();
    const secret = process.env.META_LIVRAISON_WEBHOOK_SECRET?.trim() ?? '';
    const signee = signatureMetaValide(corpsBrut, request.headers.get('x-metalivraison-signature'), secret);

    let corps: unknown = null;
    try {
      corps = JSON.parse(corpsBrut) as unknown;
    } catch {
      corps = null;
    }

    if (!signee) {
      await journaliserRejetWebhookMeta(
        corps ?? corpsBrut.slice(0, 2000),
        false,
        'signature_invalide',
        secret ? 'Signature absente ou fausse' : 'META_LIVRAISON_WEBHOOK_SECRET non configuré'
      );
      return reponse(401, { success: false, error: 'Signature invalide' });
    }

    const evenement = analyserEvenementMeta(corps);
    if (!evenement) {
      await journaliserRejetWebhookMeta(corps ?? corpsBrut.slice(0, 2000), true, 'corps_invalide', 'Payload illisible');
      return reponse(400, { success: false, error: 'Payload illisible' });
    }

    const resultat = await traiterInformationMeta({
      source: 'webhook',
      evenement,
      charge: corps,
      signatureValide: true,
      livraisonId: request.headers.get('x-metalivraison-delivery'),
    });

    return reponse(200, { success: true, issue: resultat.issue });
  } catch (error) {
    console.error('Webhook Meta Livraison :', error);
    return reponse(500, { success: false, error: 'Erreur interne' });
  }
}
