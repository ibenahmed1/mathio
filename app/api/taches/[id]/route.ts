import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import {
  ROLES_BACKOFFICE_TACHES,
  peutModifierTache,
  boardsVisibles,
  boardAutorise,
  exigerBoardAutorise,
  exigerTacheAutorisee,
  validerEtiquettes,
  exigerAssigneAutorise,
} from '@/lib/taches-scope';
import type { Prisma } from '@/app/generated/prisma/client';
import { STATUTS_TACHE, PRIORITES_TACHE } from '@/lib/statuts';

const ROLES_BACKOFFICE = ROLES_BACKOFFICE_TACHES;

const INCLUDE = {
  team: true,
  assignee: { select: { id: true, nomComplet: true } },
  createur: { select: { id: true, nomComplet: true } },
  commentaires: {
    orderBy: { dateCreation: 'asc' },
    include: { auteur: { select: { id: true, nomComplet: true } } },
  },
  historiqueStatuts: {
    orderBy: { horodatage: 'asc' },
    include: { utilisateur: { select: { id: true, nomComplet: true } } },
  },
  piecesJointes: {
    orderBy: { dateAjout: 'asc' },
    include: { auteur: { select: { id: true, nomComplet: true } } },
  },
} satisfies Prisma.TacheInclude;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const { id } = await params;

    const tache = await prisma.tache.findUnique({ where: { id }, include: INCLUDE });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    exigerTacheAutorisee(session, await boardsVisibles(session), tache);

    return NextResponse.json(tache);
  } catch (error) {
    return jsonError(error);
  }
}

// Utilisé aussi bien par le drawer de détail (édition des champs) que par le
// sélecteur rapide de statut / le drag-and-drop des cartes du Kanban.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const { id } = await params;
    const body = await request.json();

    const existant = await prisma.tache.findUnique({ where: { id } });
    if (!existant) throw new ApiError(404, 'Tâche introuvable');

    const scope = await boardsVisibles(session);
    exigerTacheAutorisee(session, scope, existant);

    if (!peutModifierTache(session, existant)) {
      throw new ApiError(403, 'Vous ne pouvez modifier que les tâches que vous avez créées ou qui vous sont attribuées');
    }

    const data: Prisma.TacheUpdateInput = {};

    if (typeof body.titre === 'string') {
      const titre = body.titre.trim();
      if (!titre) throw new ApiError(400, 'titre ne peut pas être vide');
      data.titre = titre;
    }
    if ('description' in body) {
      data.description = typeof body.description === 'string' && body.description ? body.description : null;
    }

    // Statut et progression sont traités ensemble : une progression >= 50%
    // fait automatiquement passer une tâche encore "à faire" en "en cours"
    // (jamais de rétrogradation automatique), et le passage à "Terminé"
    // complète toujours la barre de progression.
    let nouveauStatut: (typeof STATUTS_TACHE)[number] | undefined;
    if (typeof body.statut === 'string') {
      if (!STATUTS_TACHE.includes(body.statut as (typeof STATUTS_TACHE)[number])) {
        throw new ApiError(400, `statut invalide. Valeurs possibles : ${STATUTS_TACHE.join(', ')}`);
      }
      nouveauStatut = body.statut as (typeof STATUTS_TACHE)[number];
    }

    let nouveauProgress: number | undefined;
    if ('progress' in body) {
      const progress = Number(body.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        throw new ApiError(400, 'progress doit être un entier entre 0 et 100');
      }
      nouveauProgress = progress;
    }

    if (nouveauStatut === 'termine') nouveauProgress = 100;

    const progressEffectif = nouveauProgress ?? existant.progress;
    const statutDeBase = nouveauStatut ?? existant.statut;
    if (progressEffectif >= 50 && statutDeBase === 'a_faire') {
      nouveauStatut = 'en_cours';
    }

    if (nouveauStatut !== undefined) data.statut = nouveauStatut;
    if (nouveauProgress !== undefined) data.progress = nouveauProgress;

    // Marquage de blocage : une raison explicite est exigée tant que la
    // tâche reste bloquée (que ce PATCH la bloque ou modifie seulement le
    // texte de la raison) ; débloquer efface la raison.
    if ('bloque' in body || 'raisonBlocage' in body) {
      const bloqueVoulu = 'bloque' in body ? Boolean(body.bloque) : existant.bloque;
      if (bloqueVoulu) {
        const raison =
          typeof body.raisonBlocage === 'string' ? body.raisonBlocage.trim() : (existant.raisonBlocage ?? '');
        if (!raison) throw new ApiError(400, 'raisonBlocage est requis pour marquer une tâche comme bloquée');
        data.bloque = true;
        data.raisonBlocage = raison;
      } else {
        data.bloque = false;
        data.raisonBlocage = null;
      }
    }

    if ('etiquettes' in body) {
      data.etiquettes = await validerEtiquettes(body.etiquettes);
    }
    if (typeof body.priorite === 'string') {
      if (!PRIORITES_TACHE.includes(body.priorite as (typeof PRIORITES_TACHE)[number])) {
        throw new ApiError(400, `priorite invalide. Valeurs possibles : ${PRIORITES_TACHE.join(', ')}`);
      }
      data.priorite = body.priorite as (typeof PRIORITES_TACHE)[number];
    }
    if (typeof body.teamId === 'string' && body.teamId) {
      const team = await prisma.equipeTache.findUnique({ where: { id: body.teamId } });
      if (!team) throw new ApiError(400, 'Équipe invalide');
      // Déplacer une tâche vers un pôle dont on n'est pas membre reviendrait à
      // la faire disparaître de son propre tableau.
      if (!boardAutorise(scope, team.id)) throw new ApiError(403, 'Vous ne faites pas partie de ce board');
      data.team = { connect: { id: team.id } };
    }
    if ('assigneeId' in body) {
      // Assignation réservée aux rôles hors Kanban-only (design, gestionnaire_hub) —
      // cf. app/api/taches/route.ts pour la même règle côté création.
      if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
        throw new ApiError(403, 'Accès refusé : ce rôle ne peut pas assigner de tâche');
      }
      if (typeof body.assigneeId === 'string' && body.assigneeId) {
        const assignee = await prisma.utilisateur.findUnique({ where: { id: body.assigneeId } });
        if (!assignee) throw new ApiError(400, 'assigneeId invalide');
        // Board d'arrivée : une même requête peut déplacer la tâche ET la
        // réattribuer, l'appartenance se vérifie sur le pôle de destination.
        const teamIdCible = typeof body.teamId === 'string' && body.teamId ? body.teamId : existant.teamId;
        await exigerAssigneAutorise(session, teamIdCible, assignee.id);
        data.assignee = { connect: { id: assignee.id } };
      } else {
        data.assignee = { disconnect: true };
      }
    }
    if ('dateEcheance' in body) {
      data.dateEcheance = typeof body.dateEcheance === 'string' && body.dateEcheance ? new Date(body.dateEcheance) : null;
    }

    const tache = await prisma.$transaction(async (tx) => {
      const updated = await tx.tache.update({ where: { id }, data, include: INCLUDE });

      // Traçabilité du temps passé par colonne (§ /admin/tasks).
      if (nouveauStatut !== undefined && nouveauStatut !== existant.statut) {
        await tx.historiqueStatutTache.create({
          data: { tacheId: id, ancienStatut: existant.statut, nouveauStatut, utilisateurId: session.sub },
        });
      }

      return updated;
    });

    return NextResponse.json(tache);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    // La suppression ne fait pas partie des actions accordées aux exécutants
    // Kanban-only (création, édition, déplacement des cartes attribuées,
    // commentaires) — réservée au reste du back-office.
    if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
      throw new ApiError(403, 'Accès refusé pour ce rôle');
    }
    const { id } = await params;

    const existant = await prisma.tache.findUnique({ where: { id } });
    if (!existant) throw new ApiError(404, 'Tâche introuvable');
    // Contrairement à la lecture, la suppression exige d'appartenir au pôle :
    // porter une tâche confiée de l'extérieur autorise à la faire avancer, pas
    // à l'effacer du tableau d'une autre équipe.
    exigerBoardAutorise(await boardsVisibles(session), existant.teamId);

    await prisma.tache.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
