import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { creerSimulation, listerSimulations, perimetreSimulations } from '@/lib/simulations-rentabilite';

// § Simulateur de rentabilité — scénarios enregistrés du carnet de
// l'utilisateur connecté (plateforme ou boutique, cf.
// lib/simulations-rentabilite.ts).

export async function GET() {
  try {
    const { marchandId } = await perimetreSimulations();
    return NextResponse.json(
      { data: await listerSimulations(marchandId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const perimetre = await perimetreSimulations();
    const corps = await request.json().catch(() => null);
    return NextResponse.json(await creerSimulation(perimetre, corps ?? {}), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
