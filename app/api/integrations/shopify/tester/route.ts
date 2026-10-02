import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { testerConnexionShopify, validerSaisie, versApiError } from '@/lib/shopify';

// § Intégration Shopify — tester des identifiants SANS rien enregistrer.
// Aucune écriture en base : un jeton faux n'y atterrit jamais, même chiffré.
export async function POST(request: Request) {
  try {
    await requireUser(['marchand']);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, 'Corps JSON attendu');

    try {
      const saisie = validerSaisie(body);
      const infos = await testerConnexionShopify(saisie);
      return NextResponse.json({ infos });
    } catch (error) {
      throw versApiError(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
