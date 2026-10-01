import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// § Notifications — enregistrement d'un navigateur qui accepte le push.
//
// Appelé à l'activation ET à chaque ouverture de l'application : Firebase peut
// faire tourner le jeton d'un navigateur, et c'est le seul moment où l'on
// apprend le nouveau. L'upsert sur `jeton` réattribue aussi un navigateur
// partagé (poste du hub) au compte qui vient de s'y connecter.

function lireJeton(body: unknown): string {
  const jeton = typeof (body as { jeton?: unknown })?.jeton === 'string' ? (body as { jeton: string }).jeton.trim() : '';
  // Un jeton FCM fait environ 150 à 200 caractères ; la borne n'est là que
  // pour refuser n'importe quoi de volumineux.
  if (!jeton || jeton.length > 4096) throw new ApiError(400, 'jeton est requis');
  return jeton;
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json().catch(() => ({}));
    const jeton = lireJeton(body);

    // Une session d'impersonation est celle d'un admin assis devant SON
    // navigateur : l'abonner ferait recevoir au support les notifications du
    // marchand bien après la fin du dépannage.
    if (session.impersonated) {
      return NextResponse.json({ enregistre: false, raison: 'impersonation' });
    }

    const navigateur =
      typeof body?.navigateur === 'string' ? body.navigateur.trim().slice(0, 200) || null : null;
    await prisma.appareilPush.upsert({
      where: { jeton },
      create: { jeton, utilisateurId: session.sub, espace: session.space, navigateur },
      update: { utilisateurId: session.sub, espace: session.space, navigateur, dernierVuLe: new Date() },
    });
    return NextResponse.json({ enregistre: true });
  } catch (error) {
    return jsonError(error);
  }
}

// Désabonnement explicite, et surtout à la DÉCONNEXION (lib/deconnexion.ts) :
// sur un téléphone partagé, la personne suivante ne doit pas recevoir les
// alertes de la précédente. Borné au compte connecté.
export async function DELETE(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json().catch(() => ({}));
    const jeton = lireJeton(body);
    await prisma.appareilPush.deleteMany({ where: { jeton, utilisateurId: session.sub } });
    return NextResponse.json({ supprime: true });
  } catch (error) {
    return jsonError(error);
  }
}
