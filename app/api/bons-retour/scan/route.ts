import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { resolveHubPlanification } from '@/lib/bon-distribution';
import { codeSuiviDepuisScan, resolveColisPourRetour } from '@/lib/bon-retour';

const ROLES_COMPOSITION = ['admin', 'planner'] as const;

// Scan pendant la COMPOSITION du bon (§ /admin/bon-retour/**) : le
// Planner passe les colis un par un devant la caméra, et le marchand du bon
// se fixe au premier scan.
//
// Ne mute rien — le panier reste côté client jusqu'à POST /api/bons-retour,
// même principe que POST /api/bons-distribution/scan. Un scan qui écrirait en
// base rendrait impossible d'abandonner une composition entamée par erreur.
//
// `marchandAttendu` est renvoyé par le client à partir du premier colis déjà
// dans son panier : c'est ce qui permet de refuser tout de suite un colis
// d'une autre boutique, avec un message qui nomme les deux.
export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_COMPOSITION]);
    const body = await request.json();

    const hub = await resolveHubPlanification(session, typeof body.hubId === 'string' ? body.hubId : null);

    const code = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    const commande = await resolveColisPourRetour(code, {
      hubId: hub.id,
      marchandAttendu: typeof body.marchandAttendu === 'string' ? body.marchandAttendu.trim() : null,
    });

    return NextResponse.json(commande);
  } catch (error) {
    return jsonError(error);
  }
}
