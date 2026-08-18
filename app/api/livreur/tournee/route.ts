import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getFeuilleDeRouteLivreur } from '@/lib/livreur';

// § /livreur/colis : feuille de route du livreur connecté — les colis de ses
// tournées NON clôturées, avec le récapitulatif de session recalculé en temps
// réel (cash brut encaissé, colis restant à tenter, colis à retourner au
// dépôt). Une tournée clôturée par le Planner disparaît d'elle-même de cette
// réponse : rien n'est supprimé, seul le périmètre "actif" se vide.
export async function GET() {
  try {
    const session = await requireUser(['livreur']);
    const feuille = await getFeuilleDeRouteLivreur(session.sub);
    return NextResponse.json(feuille);
  } catch (error) {
    return jsonError(error);
  }
}
