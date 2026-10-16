import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { resolveHubPlanification } from '@/lib/bon-distribution';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';
import { receptionnerRetourTransporteur } from '@/lib/retour-transporteur';

// § Réception d'un retour transporteur : le colis est physiquement au quai.
// C'est le SEUL geste qui fait passer un colis confié par API à « Retourné au
// hub » — la déclaration du transporteur n'y suffit jamais (décidé le
// 11/10/2026). Le planner scanne pour son hub ; l'admin choisit le hub.
// Idempotent : un second scan renvoie `dejaScanne` sans rien réécrire.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const body = await request.json();
    const hub = await resolveHubPlanification(session, typeof body.hubId === 'string' ? body.hubId : null);
    const code = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );
    const auteur = await prisma.utilisateur.findUnique({ where: { id: session.sub }, select: { nomComplet: true } });
    const resultat = await receptionnerRetourTransporteur(code, hub, {
      id: session.sub,
      nom: auteur?.nomComplet ?? 'Planificateur',
    });
    return NextResponse.json(resultat);
  } catch (error) {
    return jsonError(error);
  }
}
