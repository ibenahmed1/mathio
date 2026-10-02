import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import {
  connecterBoutique,
  deconnecterBoutique,
  lireEtatBoutique,
  urlWebhookShopify,
  validerSaisie,
  versApiError,
} from '@/lib/shopify';

// § Intégration Shopify — la boutique du marchand connecté
// (/marchand/integrations). Réservé au rôle marchand : c'est SA boutique, et
// les secrets saisis ici ne sont jamais relus par aucun écran.

async function marchandConnecte(): Promise<string> {
  const session = await requireUser(['marchand']);
  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand.id;
}

export async function GET() {
  try {
    const marchandId = await marchandConnecte();
    const boutique = await lireEtatBoutique(marchandId);
    return NextResponse.json({ boutique, urlPubliqueConfiguree: urlWebhookShopify() !== null });
  } catch (error) {
    return jsonError(error);
  }
}

// Connexion : test des identifiants auprès de Shopify, PUIS enregistrement.
export async function POST(request: Request) {
  try {
    const marchandId = await marchandConnecte();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, 'Corps JSON attendu');

    try {
      const saisie = validerSaisie(body);
      const resultat = await connecterBoutique(marchandId, saisie);
      const boutique = await lireEtatBoutique(marchandId);
      return NextResponse.json(
        { boutique, synchro: resultat.synchro, erreurSynchro: resultat.erreurSynchro },
        { status: 201 }
      );
    } catch (error) {
      throw versApiError(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const marchandId = await marchandConnecte();
    try {
      await deconnecterBoutique(marchandId);
    } catch (error) {
      throw versApiError(error);
    }
    return NextResponse.json({ boutique: await lireEtatBoutique(marchandId) });
  } catch (error) {
    return jsonError(error);
  }
}
