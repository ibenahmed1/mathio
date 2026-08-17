import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_GESTION_EQUIPES = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'] as const;

// Équipes/pôles internes (§ /admin/tasks) — créées par le seed, consultées
// pour peupler le filtre équipe et le formulaire de création de tâche. Le
// détail des membres (workflow d'assignation) est inclus pour alimenter le
// multi-select de gestion d'équipe sans aller-retour supplémentaire.
export async function GET() {
  try {
    await requireUser([...ROLES_GESTION_EQUIPES]);

    const equipes = await prisma.equipeTache.findMany({
      orderBy: { nom: 'asc' },
      include: {
        membres: {
          orderBy: { dateAjout: 'asc' },
          include: { utilisateur: { select: { id: true, nomComplet: true, email: true, role: true, actif: true } } },
        },
      },
    });

    return NextResponse.json({ data: equipes });
  } catch (error) {
    return jsonError(error);
  }
}

// Création d'un nouveau pôle interne — réservée à l'admin pour éviter une
// prolifération d'équipes créées par erreur depuis le Kanban.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase().replace(/\s+/g, '_') : '';
    const couleur = typeof body.couleur === 'string' && body.couleur ? body.couleur : 'gray';

    if (!nom || !code) {
      throw new ApiError(400, 'nom et code sont requis');
    }

    const existant = await prisma.equipeTache.findUnique({ where: { code } });
    if (existant) {
      throw new ApiError(409, 'Une équipe avec ce code existe déjà');
    }

    const equipe = await prisma.equipeTache.create({ data: { nom, code, couleur }, include: { membres: true } });

    return NextResponse.json(equipe, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
