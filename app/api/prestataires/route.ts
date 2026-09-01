import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Prestataires de sous-traitance (§ /admin/hubs) — même référentiel, même
// public que les hubs : c'est le pendant externe du réseau interne, on ne lui
// ouvre pas une permission séparée.
export async function GET() {
  try {
    await requireUser(['admin']);

    const prestataires = await prisma.prestataire.findMany({
      orderBy: { nom: 'asc' },
      include: {
        // Les agences du prestataire et leur couverture : c'est ce qui répond
        // à "qu'est-ce que ce prestataire livre pour nous aujourd'hui ?".
        agences: {
          orderBy: { nom: 'asc' },
          select: { id: true, nom: true, ville: true, _count: { select: { villes: true } } },
        },
        _count: { select: { tarifs: true } },
      },
    });

    return NextResponse.json({
      data: prestataires.map((p) => ({
        ...p,
        agences: p.agences.map((a) => ({ id: a.id, nom: a.nom, ville: a.ville, nbVilles: a._count.villes })),
        // Nombre de villes TARIFÉES — volontairement distinct du nombre de
        // villes couvertes : un prestataire peut être tarifé sur une ville
        // qu'un autre dessert (cf. TarifPrestataireVille).
        nbVillesTarifees: p._count.tarifs,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    if (!nom) {
      throw new ApiError(400, 'nom est requis');
    }

    const texteOuNull = (valeur: unknown) =>
      typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null;

    try {
      const prestataire = await prisma.prestataire.create({
        data: {
          nom,
          contact: texteOuNull(body.contact),
          telephone: texteOuNull(body.telephone),
          email: texteOuNull(body.email),
        },
      });
      return NextResponse.json(prestataire, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Ce prestataire existe déjà');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
