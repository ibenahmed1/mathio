import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.PrestataireUpdateInput = {};
    if (typeof body.nom === 'string' && body.nom.trim()) {
      data.nom = body.nom.trim();
    }
    for (const champ of ['contact', 'telephone', 'email'] as const) {
      if (body[champ] !== undefined) {
        data[champ] = typeof body[champ] === 'string' && body[champ].trim() ? body[champ].trim() : null;
      }
    }
    if (typeof body.actif === 'boolean') {
      data.actif = body.actif;
    }

    // § Comptes transporteurs : rattachement du compte humain. Chaîne vide =
    // détachement explicite, et non « champ absent » — c'est ce qui permet de
    // retirer un compte sans en poser un autre. Le compte doit être un compte
    // livreur de type société : un livreur individuel n'est le compte de
    // personne d'autre que lui-même, et un compte du back-office n'a pas
    // d'espace terrain où recevoir des colis.
    if (body.compteLivreurId !== undefined) {
      const compteLivreurId = typeof body.compteLivreurId === 'string' ? body.compteLivreurId.trim() : '';
      if (!compteLivreurId) {
        data.compteLivreur = { disconnect: true };
      } else {
        const compte = await prisma.utilisateur.findUnique({
          where: { id: compteLivreurId },
          select: { id: true, role: true, typeLivreur: true, prestataireRattache: { select: { id: true } } },
        });
        if (!compte) {
          throw new ApiError(400, 'Compte introuvable');
        }
        if (compte.role !== 'livreur' || compte.typeLivreur !== 'societe') {
          throw new ApiError(400, 'Seul un compte livreur de type société peut être rattaché à un transporteur');
        }
        // Le doublon est déjà interdit en base (index unique), mais le message
        // de Postgres ne dirait pas LEQUEL des deux transporteurs le détient.
        if (compte.prestataireRattache && compte.prestataireRattache.id !== id) {
          throw new ApiError(409, 'Ce compte est déjà rattaché à un autre transporteur');
        }
        data.compteLivreur = { connect: { id: compteLivreurId } };
      }
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const prestataire = await prisma.prestataire.update({ where: { id }, data });
      return NextResponse.json(prestataire);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ApiError(409, 'Ce prestataire existe déjà');
        if (error.code === 'P2025') throw new ApiError(404, 'Prestataire introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression réservée au prestataire qui n'a jamais servi : dès qu'une agence
// lui est rattachée, on désactive (PATCH actif:false) plutôt que de supprimer,
// pour ne pas perdre l'historique tarifaire des colis déjà livrés. Les tarifs
// eux-mêmes tombent en cascade (cf. TarifPrestataireVille).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const nbAgences = await prisma.hub.count({ where: { prestataireId: id } });
    if (nbAgences > 0) {
      throw new ApiError(
        409,
        `Ce prestataire a ${nbAgences} agence(s) rattachée(s) : détachez-les d'abord, ou désactivez le prestataire.`
      );
    }

    try {
      await prisma.prestataire.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'Prestataire introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
