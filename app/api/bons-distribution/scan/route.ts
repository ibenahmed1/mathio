import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';
import { resolveColisParCode, resolveHubPlanification } from '@/lib/bon-distribution';

// § Étape 3 de la création d'un Bon de Distribution, champ "CLIC ICI AVANT LE
// SCAN" : résout un codeSuivi/QR (même logique que
// POST /api/bons-envoi/verifier-colis) et vérifie son éligibilité pour le
// couple zone/livreur choisi. Ne mute rien — le panier reste géré côté
// client jusqu'à POST /api/bons-distribution.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const body = await request.json();

    const hub = await resolveHubPlanification(session, typeof body.hubId === 'string' ? body.hubId : null);
    const livreurId = typeof body.livreurId === 'string' ? body.livreurId.trim() : '';
    if (!livreurId) {
      throw new ApiError(400, 'livreurId est requis');
    }

    const codeSuivi = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    const commande = await resolveColisParCode(hub.id, livreurId, codeSuivi);
    return NextResponse.json(commande);
  } catch (error) {
    return jsonError(error);
  }
}
