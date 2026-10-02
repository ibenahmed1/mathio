import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { boutiqueConnectee, lireEtatBoutique, rattraperCommandes, versApiError } from '@/lib/shopify';

// § Intégration Shopify — importer les commandes récentes que le webhook n'a
// pas apportées (passées avant la connexion, ou webhook en échec). Rejouable :
// une commande déjà reçue n'est jamais doublée (cf. rattraperCommandes).
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      const rattrapage = await rattraperCommandes(await boutiqueConnectee(marchand.id));
      return NextResponse.json({ rattrapage, boutique: await lireEtatBoutique(marchand.id) });
    } catch (error) {
      throw versApiError(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
