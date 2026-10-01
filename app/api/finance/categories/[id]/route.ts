import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { perimetreComptable } from '@/lib/comptabilite-perimetre';
import { renommerCategorie, supprimerCategorie } from '@/lib/journal-comptable';

// Renommer une catégorie : le nouveau nom vaut pour toutes les pièces qui la
// portent, passées comprises — elles pointent son identifiant.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, marchandId } = await perimetreComptable('modification');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const categorie = await renommerCategorie(id, body?.nom, session.sub, marchandId);
    return NextResponse.json(categorie);
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression PHYSIQUE, à la différence des écritures : une catégorie ne
// porte aucun montant, et elle n'est supprimable que si plus rien ne la
// porte (409 sinon, cf. supprimerCategorie). Sa trace reste dans
// HistoriqueComptable.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, marchandId } = await perimetreComptable('suppression');
    const { id } = await params;
    await supprimerCategorie(id, session.sub, marchandId);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
