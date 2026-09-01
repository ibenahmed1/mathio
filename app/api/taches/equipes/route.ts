import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { EQUIPE_COULEUR_LABEL, normaliserCode } from '@/lib/statuts';
import { boardsVisibles } from '@/lib/taches-scope';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';

const ROLES_GESTION_EQUIPES = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'] as const;

// Équipes/pôles internes (§ /admin/tasks) — créées par le seed, consultées
// pour peupler le filtre équipe et le formulaire de création de tâche. Le
// détail des membres (workflow d'assignation) est inclus pour alimenter le
// multi-select de gestion d'équipe sans aller-retour supplémentaire.
// Par défaut la liste est cloisonnée comme les tâches : on ne voit que les
// pôles dont on est membre (l'admin voit tout, § boardsVisibles). `?toutes=1`
// rend la liste complète — nécessaire à la modale de gestion d'équipe, qui
// sert justement à rattacher des comptes à des pôles où l'on ne figure pas
// encore ; elle reste fermée aux rôles Kanban-only, qui ne gèrent aucune
// composition.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_GESTION_EQUIPES]);
    const toutes = request.nextUrl.searchParams.get('toutes') === '1';
    if (toutes && ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
      throw new ApiError(403, 'Accès refusé pour ce rôle');
    }
    const scope = toutes ? null : await boardsVisibles(session);

    const equipes = await prisma.equipeTache.findMany({
      where: scope === null ? undefined : { id: { in: scope } },
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

const COULEURS_AUTORISEES = Object.keys(EQUIPE_COULEUR_LABEL);

// Création d'un nouveau pôle interne — réservée à l'admin pour éviter une
// prolifération d'équipes créées par erreur depuis le Kanban. Modification et
// suppression suivent la même règle, cf. app/api/taches/equipes/[id]/route.ts.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const codeFourni = typeof body.code === 'string' ? body.code : '';
    const code = normaliserCode(codeFourni || nom);
    const couleur = typeof body.couleur === 'string' && body.couleur ? body.couleur : 'gray';

    if (!nom) {
      throw new ApiError(400, 'Le nom du pôle est requis');
    }
    if (!code) {
      throw new ApiError(400, 'Le code du pôle est requis');
    }
    if (!COULEURS_AUTORISEES.includes(couleur)) {
      throw new ApiError(400, `Couleur invalide. Valeurs possibles : ${COULEURS_AUTORISEES.join(', ')}`);
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
