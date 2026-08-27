import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { Prisma } from '@/app/generated/prisma/client';

// Fiche détail admin : toutes les infos KYC/bancaires saisies à l'inscription,
// jamais visibles depuis la liste (voir /api/marchands, colonnes limitées).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const marchand = await prisma.marchand.findUnique({
      where: { id },
      include: {
        utilisateur: {
          select: { id: true, nomComplet: true, telephone: true, email: true, actif: true, dateCreation: true, derniereConnexion: true },
        },
        adresses: true,
        membres: { include: { utilisateur: { select: { id: true, nomComplet: true, email: true, actif: true } } } },
        _count: { select: { commandes: true, ramassages: true, marchandises: true } },
      },
    });
    if (!marchand) {
      throw new ApiError(404, 'Marchand introuvable');
    }

    return NextResponse.json(marchand);
  } catch (error) {
    return jsonError(error);
  }
}

// RF-22 : suppression définitive d'un compte marchand par l'admin (ex. compte
// créé par erreur ou refusé). Supprime aussi l'utilisateur lié.
// § Facturation marchand : frais PAR DÉFAUT appliqués à toute ville sans
// ligne dans TarifMarchandVille.
//
// Volontairement limité à ces deux champs : les données KYC/bancaires saisies
// à l'inscription ne s'éditent pas par cette route, pour qu'un formulaire de
// tarification ne puisse jamais réécrire un RIB par effet de bord.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.MarchandUpdateInput = {};

    for (const champ of ['fraisLivraison', 'fraisRetour'] as const) {
      if (body[champ] === undefined) continue;
      // Chaîne vide = "revenir à aucun frais par défaut" (null), distinct de 0
      // qui est un tarif gratuit assumé.
      if (body[champ] === null || body[champ] === '') {
        data[champ] = null;
        continue;
      }
      const valeur = Number(body[champ]);
      if (!Number.isFinite(valeur) || valeur < 0) {
        throw new ApiError(400, 'Les frais doivent être des montants positifs');
      }
      data[champ] = valeur;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    const marchand = await prisma.marchand.findUnique({ where: { id }, select: { id: true } });
    if (!marchand) throw new ApiError(404, 'Marchand introuvable');

    const updated = await prisma.marchand.update({
      where: { id },
      data,
      select: { id: true, fraisLivraison: true, fraisRetour: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const marchand = await prisma.marchand.findUnique({ where: { id } });
    if (!marchand) {
      throw new ApiError(404, 'Marchand introuvable');
    }

    try {
      await prisma.$transaction([
        prisma.marchand.delete({ where: { id } }),
        prisma.utilisateur.delete({ where: { id: marchand.utilisateurId } }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(409, 'Impossible de supprimer : ce marchand a des colis ou ramassages liés');
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
