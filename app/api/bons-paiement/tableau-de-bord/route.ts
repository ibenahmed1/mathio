import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getTableauDeBordMensuel, periodePrecedente } from '@/lib/bon-paiement';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Tableau de bord mensuel de la paie livreur (§ /admin/bon-paiement) : KPIs du
// mois et état de chaque livreur (payé / en attente / non généré).
//
// Sans `annee`/`mois`, on ouvre sur le mois ÉCOULÉ : c'est celui qu'il y a à
// payer. Ouvrir sur le mois courant afficherait le 2 du mois un tableau vide
// et laisserait croire qu'il n'y a rien à faire.
export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { searchParams } = request.nextUrl;

    const defaut = periodePrecedente(new Date());
    const annee = Number(searchParams.get('annee')) || defaut.annee;
    const mois = Number(searchParams.get('mois')) || defaut.mois;

    return NextResponse.json(await getTableauDeBordMensuel(annee, mois, searchParams.get('hubId')));
  } catch (error) {
    return jsonError(error);
  }
}
