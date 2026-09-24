import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { getStatsBonsDistributionLivreur, getStatsColisLivreur, getVolumeParJourLivreur } from '@/lib/livreur';

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

    // Hub de rattachement — FACULTATIF depuis l'ouverture des comptes société
    // (§ hubRequis, lib/comptes-livreur.ts) : une société de livraison n'a pas
    // de quai chez nous. `resolveUserHub` lève un 403 dans ce cas, ce qui
    // rendrait tout son accueil inaccessible ; on lit donc le rattachement
    // sans l'exiger, et son absence ne restreint simplement plus rien.
    const utilisateur = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { hubId: true },
    });

    const [colis, bonsDistribution, volume] = await Promise.all([
      getStatsColisLivreur(session.sub, dateDebut, dateFin),
      getStatsBonsDistributionLivreur(session.sub, utilisateur?.hubId ?? null, dateDebut, dateFin),
      getVolumeParJourLivreur(session.sub, dateDebut, dateFin),
    ]);

    return NextResponse.json({ colis, bonsDistribution, volume });
  } catch (error) {
    return jsonError(error);
  }
}
