import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { prefixesDeLEspace } from '@/lib/notifications-catalogue';

// § Notifications — la cloche du compte connecté.
//
// requireUser() SANS liste de rôles, et c'est voulu : chaque compte, quel que
// soit son espace, a sa cloche. Le périmètre est dans la requête — on ne lit
// jamais que les lignes de `session.sub` — et non dans le rôle.

const PAR_PAGE = 20;

export async function GET(request: Request) {
  try {
    const session = await requireUser();

    // Pagination par curseur de date (« plus anciennes que… ») : une cloche se
    // lit du plus récent au plus ancien, et un décalage numérique sauterait ou
    // répéterait des lignes dès qu'une notification arrive entre deux pages.
    const params = new URL(request.url).searchParams;
    const avantParam = params.get('avant');
    // Centre de notifications : onglet « Non lues ». Le compteur reste, lui,
    // celui de toute la cloche.
    const seulementNonLues = params.get('etat') === 'non_lues';
    const avant = avantParam ? new Date(avantParam) : null;
    if (avant && Number.isNaN(avant.getTime())) throw new ApiError(400, 'avant doit être une date ISO');

    const dansLEspace = {
      utilisateurId: session.sub,
      OR: [{ lien: null }, ...prefixesDeLEspace(session.space).map((p) => ({ lien: { startsWith: p } }))],
    };

    const [notifications, nonLues] = await Promise.all([
      prisma.notification.findMany({
        where: { ...dansLEspace, ...(avant && { creeLe: { lt: avant } }), ...(seulementNonLues && { lueLe: null }) },
        orderBy: { creeLe: 'desc' },
        take: PAR_PAGE,
        select: { id: true, type: true, titre: true, corps: true, lien: true, lueLe: true, creeLe: true },
      }),
      prisma.notification.count({ where: { ...dansLEspace, lueLe: null } }),
    ]);

    return NextResponse.json({ notifications, nonLues, suite: notifications.length === PAR_PAGE });
  } catch (error) {
    return jsonError(error);
  }
}
