import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { contexteEquipe } from '@/lib/equipe-marchand';

const TAILLE_PAGE = 30;

// Journal d'équipe de la boutique, du plus récent au plus ancien, paginé par
// curseur (`?avant=<id>`) : il ne fait que grossir, et l'écran le charge par
// « Voir plus ». Lecture gardée par `equipe.voir` (proxy).
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const avant = request.nextUrl.searchParams.get('avant');

    const lignes = await prisma.journalEquipeMarchand.findMany({
      where: { marchandId: ctx.marchand.id },
      orderBy: [{ horodatage: 'desc' }, { id: 'desc' }],
      take: TAILLE_PAGE + 1,
      ...(avant ? { cursor: { id: avant }, skip: 1 } : {}),
      include: { auteur: { select: { nomComplet: true } } },
    });

    const suite = lignes.length > TAILLE_PAGE;
    const page = lignes.slice(0, TAILLE_PAGE);

    return NextResponse.json({
      data: page.map((l) => ({
        id: l.id,
        action: l.action,
        cible: l.cible,
        details: l.details,
        horodatage: l.horodatage,
        auteur: l.auteur.nomComplet,
      })),
      suivant: suite ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
