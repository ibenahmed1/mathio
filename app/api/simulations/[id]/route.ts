import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { modifierSimulation, perimetreSimulations, supprimerSimulation } from '@/lib/simulations-rentabilite';

// § Simulateur de rentabilité — un scénario enregistré : le renommer, le
// réécrire avec la saisie en cours, le supprimer. Un identifiant hors du
// carnet de l'utilisateur répond 404.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const perimetre = await perimetreSimulations();
    const { id } = await params;
    const corps = await request.json().catch(() => null);
    return NextResponse.json(await modifierSimulation(perimetre, id, corps ?? {}));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const perimetre = await perimetreSimulations();
    const { id } = await params;
    await supprimerSimulation(perimetre, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
