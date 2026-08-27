import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';

const ROLES_COMPOSITION = ['admin', 'planner'] as const;

// Ramasseurs actifs, avec le nombre de bons de retour déjà en cours chez
// chacun — le Planner a besoin de cette charge pour ne pas confier un
// cinquième bon à quelqu'un qui en a déjà quatre dans son véhicule.
//
// Pas de filtre par hub : contrairement au livreur, le ramasseur n'est pas
// rattaché à un hub (Utilisateur.hubId ne concerne que livreur et agent_hub,
// cf. schema.prisma) — il circule entre les marchands.
export async function GET() {
  try {
    await requireUser([...ROLES_COMPOSITION]);

    const ramasseurs = await prisma.utilisateur.findMany({
      where: { role: 'ramasseur', actif: true },
      select: {
        id: true,
        nomComplet: true,
        telephone: true,
        _count: { select: { bonsRetourAffectes: { where: { statut: 'en_cours' } } } },
      },
      orderBy: { nomComplet: 'asc' },
    });

    return NextResponse.json({
      data: ramasseurs.map((r) => ({
        id: r.id,
        nomComplet: r.nomComplet,
        telephone: r.telephone,
        bonsEnCours: r._count.bonsRetourAffectes,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
