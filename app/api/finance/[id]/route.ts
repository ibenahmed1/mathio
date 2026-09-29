import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { analyserModificationTransaction } from '@/lib/finance';
import { modifierTransaction, supprimerTransaction } from '@/lib/journal-comptable';

// Modifier et supprimer une écriture du journal (§ /admin/comptabilite).
//
// Gardées par PERMISSION et non par liste de rôles, contrairement aux routes
// voisines (CORRECTIFS_URGENTS.md §2) : ces deux gestes ont leurs propres clés,
// `comptabilite:edit` et `comptabilite:delete`, accordées par défaut au seul
// admin. Le proxy les exige déjà (lib/permission-routes.ts) ; ce contrôle le
// double pour un appel qui ne passerait pas par lui.
//
// Les deux répondent { id } : l'écran recharge le journal, dont les totaux
// bougent avec la modification — renvoyer la ligne seule ne suffirait pas.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const analyse = analyserModificationTransaction(body);
    if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);

    await modifierTransaction(id, analyse.valeur, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression LOGIQUE (§ Transaction.supprimeLe) : la ligne sort du journal et
// des totaux, reste en base et se restaure depuis la corbeille.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:delete');
    const { id } = await params;
    await supprimerTransaction(id, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
