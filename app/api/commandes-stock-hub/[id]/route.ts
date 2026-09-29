import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { analyserModificationCommandeStockHub } from '@/lib/commandes-stock-hub';
import { modifierCommandeStockHub, supprimerCommandeStockHub } from '@/lib/journal-comptable';

// Réécrire ou supprimer une commande d'inventaire (§ /admin/comptabilite).
// Même garde que les écritures du journal (app/api/finance/[id]/route.ts) :
// permissions `comptabilite:edit` / `comptabilite:delete`, admin par défaut.
// Le statut n'est pas modifiable ici — il suit son cycle par …/[id]/statut.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const analyse = analyserModificationCommandeStockHub(body);
    if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);

    await modifierCommandeStockHub(id, analyse.valeur, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression LOGIQUE (§ CommandeStockHub.supprimeLe), restaurable.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:delete');
    const { id } = await params;
    await supprimerCommandeStockHub(id, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
