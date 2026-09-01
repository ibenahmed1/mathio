import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import { ROLES_BACKOFFICE_TACHES } from '@/lib/taches-scope';
import { COULEURS_ETIQUETTE, normaliserCode } from '@/lib/statuts';

// Étiquettes de tâche (§ /admin/tasks) : la liste vit en base (EtiquetteTache)
// et non plus dans une constante — un thème s'ajoute depuis le tableau, sans
// déploiement. Les tâches stockent le `code`, jamais le libellé.

export async function GET() {
  try {
    await requireUser(ROLES_BACKOFFICE_TACHES);
    const etiquettes = await prisma.etiquetteTache.findMany({ orderBy: { nom: 'asc' } });
    return NextResponse.json({ data: etiquettes });
  } catch (error) {
    return jsonError(error);
  }
}

// Création ouverte à tout le back-office sauf les rôles Kanban-only : ils
// consomment le tableau sans en définir le vocabulaire (même règle que
// l'assignation, cf. app/api/taches/route.ts).
export async function POST(request: Request) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
      throw new ApiError(403, 'Accès refusé : ce rôle ne peut pas créer d’étiquette');
    }
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    if (!nom) throw new ApiError(400, 'nom est requis');

    const couleur = typeof body.couleur === 'string' && body.couleur ? body.couleur : 'docs';
    if (!COULEURS_ETIQUETTE.includes(couleur as (typeof COULEURS_ETIQUETTE)[number])) {
      throw new ApiError(400, `couleur invalide. Valeurs possibles : ${COULEURS_ETIQUETTE.join(', ')}`);
    }

    // Le code est dérivé du nom : c'est lui qui est stocké sur les tâches, il
    // doit rester stable et lisible même si le libellé change ensuite.
    const code = normaliserCode(typeof body.code === 'string' && body.code ? body.code : nom);
    if (!code) throw new ApiError(400, 'nom invalide : aucun code ne peut en être dérivé');

    const existante = await prisma.etiquetteTache.findUnique({ where: { code } });
    if (existante) throw new ApiError(409, `Une étiquette « ${existante.nom} » utilise déjà ce code`);

    const etiquette = await prisma.etiquetteTache.create({ data: { code, nom, couleur } });
    return NextResponse.json(etiquette, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
