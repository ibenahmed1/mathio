import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { TYPES_NOTIFICATION, nettoyerClocheCoupes, nettoyerPushCoupes } from '@/lib/notifications-catalogue';

// § Notifications — ce que ce compte reçoit, type par type, dans sa CLOCHE et
// en PUSH : deux réglages indépendants (décision du 06/10/2026).
//
// Chaque espace ne montre et ne modifie que SES types : un admin qui est aussi
// livreur règle ses alertes de tournée depuis le domaine terrain, et
// enregistrer depuis le back-office ne doit pas les écraser.

export async function GET() {
  try {
    const session = await requireUser();
    const compte = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { pushCoupes: true, clocheCoupes: true },
    });
    const types = TYPES_NOTIFICATION.filter((t) => t.espace === session.space);
    return NextResponse.json({
      types,
      pushCoupes: compte?.pushCoupes ?? [],
      clocheCoupes: compte?.clocheCoupes ?? [],
    });
  } catch (error) {
    return jsonError(error);
  }
}

// Remplace la liste des types de CET espace par celle reçue, et garde telles
// quelles celles des autres espaces.
function fusionner(existantes: string[], recues: string[], cesTypes: Set<string>): string[] {
  return [...existantes.filter((cle) => !cesTypes.has(cle)), ...recues.filter((cle) => cesTypes.has(cle))];
}

export async function PUT(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json().catch(() => ({}));
    const avecPush = body?.pushCoupes !== undefined;
    const avecCloche = body?.clocheCoupes !== undefined;
    if (!avecPush && !avecCloche) throw new ApiError(400, 'pushCoupes ou clocheCoupes est requis');
    if ((avecPush && !Array.isArray(body.pushCoupes)) || (avecCloche && !Array.isArray(body.clocheCoupes))) {
      throw new ApiError(400, 'pushCoupes et clocheCoupes doivent être des listes');
    }

    const cesTypes = new Set(TYPES_NOTIFICATION.filter((t) => t.espace === session.space).map((t) => t.cle));
    const compte = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { pushCoupes: true, clocheCoupes: true },
    });

    const pushCoupes = avecPush
      ? fusionner(compte?.pushCoupes ?? [], nettoyerPushCoupes(body.pushCoupes), cesTypes)
      : (compte?.pushCoupes ?? []);
    const clocheCoupes = avecCloche
      ? fusionner(compte?.clocheCoupes ?? [], nettoyerClocheCoupes(body.clocheCoupes), cesTypes)
      : (compte?.clocheCoupes ?? []);

    await prisma.utilisateur.update({ where: { id: session.sub }, data: { pushCoupes, clocheCoupes } });
    return NextResponse.json({ pushCoupes, clocheCoupes });
  } catch (error) {
    return jsonError(error);
  }
}
