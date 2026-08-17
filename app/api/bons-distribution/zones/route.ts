import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getHubsDistribution } from '@/lib/bon-distribution';

// § Étape 1 de la création d'un Bon de Distribution (/admin/bon-distribution/creer) :
// liste des hubs (§ /admin/hubs, référentiel existant — le hub sert
// directement de "zone" au wizard) avec le volume de colis actuellement au
// hub et le nombre de livreurs actifs qui y sont rattachés.
export async function GET() {
  try {
    await requireUser(['admin']);
    const data = await getHubsDistribution();
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
