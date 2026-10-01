import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';

// § Notifications — marquer comme lues : une sélection (`ids`), ou toute la
// cloche (`tout: true`). Borné aux lignes du compte connecté dans la requête
// même : un id d'une autre personne est simplement sans effet.
export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const body = await request.json().catch(() => ({}));

    const tout = body?.tout === true;
    const ids = parseStringIdArray(body?.ids);
    if (!tout && ids.length === 0) throw new ApiError(400, 'ids ou tout est requis');

    const { count } = await prisma.notification.updateMany({
      where: { utilisateurId: session.sub, lueLe: null, ...(!tout && { id: { in: ids } }) },
      data: { lueLe: new Date() },
    });
    return NextResponse.json({ marquees: count });
  } catch (error) {
    return jsonError(error);
  }
}
