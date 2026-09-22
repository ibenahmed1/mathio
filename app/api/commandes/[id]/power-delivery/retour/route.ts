import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { demanderRetourChezPower } from '@/lib/actions-power-delivery';

// Même borne que la note transmise aux transporteurs (NOTE_MAX,
// lib/livraison-statut.ts) : la raison est lue par leur équipe.
const RAISON_MAX = 150;

// § Power Delivery — demande à leur équipe de nous renvoyer le colis
// (`request-return`). Leur équipe accepte ou refuse de son côté.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const raison = typeof body.raison === 'string' ? body.raison.trim() : '';
    if (raison.length > RAISON_MAX) throw new ApiError(400, `raison est limitée à ${RAISON_MAX} caractères`);

    await demanderRetourChezPower(id, raison || null, session.sub);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
