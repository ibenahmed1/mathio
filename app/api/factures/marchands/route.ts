import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getMarchandsAFacturer } from '@/lib/facturation';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// § Étape 1 de /admin/factures/nouvelle — « Clients à facturer ».
//
// Les marchands ayant au moins un colis clos non encore facturé, avec le
// volume et le COD en attente. Route jumelle de /api/bons-paiement/livreurs :
// dans les deux modules, on part de la liste des personnes qui ont un solde,
// jamais du fichier complet — l'écran doit dire quoi faire, pas offrir un
// annuaire à parcourir.
export async function GET() {
  try {
    await requireUser([...ROLES_FACTURATION]);
    return NextResponse.json({ data: await getMarchandsAFacturer() });
  } catch (error) {
    return jsonError(error);
  }
}
