import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { TYPES_NOTIFICATION, nettoyerPushCoupes } from '@/lib/notifications-catalogue';

// § Notifications — quels types ce compte reçoit en PUSH. La cloche reçoit
// tout, toujours : elle n'a pas de préférence.
//
// Chaque espace ne montre et ne modifie que SES types : un admin qui est aussi
// livreur règle ses alertes de tournée depuis le domaine terrain, et
// enregistrer depuis le back-office ne doit pas les écraser.

export async function GET() {
  try {
    const session = await requireUser();
    const compte = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { pushCoupes: true },
    });
    const types = TYPES_NOTIFICATION.filter((t) => t.espace === session.space);
    return NextResponse.json({ types, pushCoupes: compte?.pushCoupes ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body?.pushCoupes)) throw new ApiError(400, 'pushCoupes doit être une liste');

    const cesTypes = new Set(TYPES_NOTIFICATION.filter((t) => t.espace === session.space).map((t) => t.cle));
    const recues = nettoyerPushCoupes(body.pushCoupes).filter((cle) => cesTypes.has(cle));

    const compte = await prisma.utilisateur.findUnique({ where: { id: session.sub }, select: { pushCoupes: true } });
    const autresEspaces = (compte?.pushCoupes ?? []).filter((cle) => !cesTypes.has(cle));
    const pushCoupes = [...autresEspaces, ...recues];

    await prisma.utilisateur.update({ where: { id: session.sub }, data: { pushCoupes } });
    return NextResponse.json({ pushCoupes });
  } catch (error) {
    return jsonError(error);
  }
}
