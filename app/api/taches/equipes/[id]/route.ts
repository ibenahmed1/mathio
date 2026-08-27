import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { EQUIPE_COULEUR_LABEL } from '@/lib/statuts';

// Cycle de vie d'un pôle (renommage, couleur, suppression) — réservé à
// l'admin, au même titre que la création (cf. POST /api/taches/equipes) : la
// composition d'une équipe se corrige tous les jours, sa structure non. Le
// reste du back-office (ROLES_GESTION_EQUIPES) garde la main sur les membres,
// pas sur les pôles eux-mêmes.
const ROLE_GESTION_POLES = ['admin'] as const;

const COULEURS_AUTORISEES = Object.keys(EQUIPE_COULEUR_LABEL);

const INCLUDE_MEMBRES = {
  membres: {
    orderBy: { dateAjout: 'asc' },
    include: { utilisateur: { select: { id: true, nomComplet: true, email: true, role: true, actif: true } } },
  },
} as const;

function normaliserCode(valeur: string): string {
  return valeur
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function getEquipe(id: string) {
  const equipe = await prisma.equipeTache.findUnique({ where: { id } });
  if (!equipe) throw new ApiError(404, 'Équipe introuvable');
  return equipe;
}

// Modification d'un pôle. Les trois champs sont optionnels et appliqués
// indépendamment : renommer sans toucher au code (qui peut servir de repère
// stable ailleurs) doit rester possible.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLE_GESTION_POLES]);
    const { id } = await params;
    await getEquipe(id);

    const body = await request.json();
    const data: { nom?: string; code?: string; couleur?: string } = {};

    if (body.nom !== undefined) {
      const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
      if (!nom) throw new ApiError(400, 'Le nom ne peut pas être vide');
      data.nom = nom;
    }

    if (body.code !== undefined) {
      const code = typeof body.code === 'string' ? normaliserCode(body.code) : '';
      if (!code) throw new ApiError(400, 'Le code ne peut pas être vide');
      const existant = await prisma.equipeTache.findUnique({ where: { code } });
      if (existant && existant.id !== id) {
        throw new ApiError(409, 'Une équipe avec ce code existe déjà');
      }
      data.code = code;
    }

    if (body.couleur !== undefined) {
      const couleur = typeof body.couleur === 'string' ? body.couleur : '';
      if (!COULEURS_AUTORISEES.includes(couleur)) {
        throw new ApiError(400, `Couleur invalide. Valeurs possibles : ${COULEURS_AUTORISEES.join(', ')}`);
      }
      data.couleur = couleur;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ à modifier');
    }

    const equipe = await prisma.equipeTache.update({ where: { id }, data, include: INCLUDE_MEMBRES });

    return NextResponse.json(equipe);
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression d'un pôle. Les rattachements de membres tombent en cascade (le
// compte utilisateur, lui, survit — il peut appartenir à d'autres pôles), mais
// les tâches sont en relation obligatoire : on refuse plutôt que de les
// supprimer avec, en indiquant combien il y en a. `?transfererVers=<id>`
// permet alors de les déplacer vers un autre pôle dans la même transaction.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLE_GESTION_POLES]);
    const { id } = await params;
    await getEquipe(id);

    const nbTaches = await prisma.tache.count({ where: { teamId: id } });
    const transfererVers = new URL(request.url).searchParams.get('transfererVers');

    if (nbTaches > 0 && !transfererVers) {
      throw new ApiError(
        409,
        `Ce pôle porte encore ${nbTaches} tâche${nbTaches > 1 ? 's' : ''} : transférez-les vers un autre pôle avant de le supprimer.`
      );
    }

    if (transfererVers) {
      if (transfererVers === id) {
        throw new ApiError(400, 'Le pôle de destination doit être différent');
      }
      const destination = await prisma.equipeTache.findUnique({ where: { id: transfererVers } });
      if (!destination) throw new ApiError(404, 'Pôle de destination introuvable');

      await prisma.$transaction([
        prisma.tache.updateMany({ where: { teamId: id }, data: { teamId: transfererVers } }),
        prisma.equipeTache.delete({ where: { id } }),
      ]);
    } else {
      await prisma.equipeTache.delete({ where: { id } });
    }

    return NextResponse.json({ success: true, tachesTransferees: transfererVers ? nbTaches : 0 });
  } catch (error) {
    return jsonError(error);
  }
}
