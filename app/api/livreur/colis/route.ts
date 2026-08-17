import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getColisLivreur } from '@/lib/livreur';
import type { StatutCommande } from '@/app/generated/prisma/enums';

const STATUTS_FILTRABLES: StatutCommande[] = ['livre', 'reporte', 'annule'];

// § /livreur/colis : liste filtrable des colis assignés au livreur connecté
// (État, Statut, Date, "Reporté pour aujourd'hui" — cf. spec module livreur).
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['livreur']);
    const { searchParams } = request.nextUrl;

    const etatParam = searchParams.get('etat');
    const statutParam = searchParams.get('statut');
    const dateDebutParam = searchParams.get('dateDebut');
    const dateFinParam = searchParams.get('dateFin');
    const reporteAujourdhui = searchParams.get('reporteAujourdhui') === '1';

    const dateDebut = dateDebutParam ? new Date(dateDebutParam) : undefined;
    const dateFin = dateFinParam ? new Date(dateFinParam) : undefined;

    const data = await getColisLivreur(session.sub, {
      etat: etatParam === 'facture' ? 'facture' : undefined,
      statut: statutParam && STATUTS_FILTRABLES.includes(statutParam as StatutCommande) ? (statutParam as StatutCommande) : undefined,
      dateDebut: dateDebut && !Number.isNaN(dateDebut.getTime()) ? dateDebut : undefined,
      dateFin: dateFin && !Number.isNaN(dateFin.getTime()) ? dateFin : undefined,
      reporteAujourdhui,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
