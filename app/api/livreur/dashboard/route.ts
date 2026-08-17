import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';
import { getStatsBonsDistributionLivreur, getStatsColisLivreur } from '@/lib/livreur';

function parseDateParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// § /livreur (Accueil) : stats Colis (Bloc 1) + Bons de Distribution (Bloc 2)
// sur la plage de dates sélectionnée — 30 derniers jours par défaut.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['livreur']);
    const { searchParams } = request.nextUrl;

    const aujourdhui = new Date();
    const ilYA30Jours = new Date(aujourdhui);
    ilYA30Jours.setDate(ilYA30Jours.getDate() - 29);

    const dateDebut = parseDateParam(searchParams.get('from'), ilYA30Jours);
    const dateFin = parseDateParam(searchParams.get('to'), aujourdhui);

    const hub = await resolveUserHub(session.sub);

    const [colis, bonsDistribution] = await Promise.all([
      getStatsColisLivreur(session.sub, dateDebut, dateFin),
      getStatsBonsDistributionLivreur(session.sub, hub.id, dateDebut, dateFin),
    ]);

    return NextResponse.json({ colis, bonsDistribution });
  } catch (error) {
    return jsonError(error);
  }
}
