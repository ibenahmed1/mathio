import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { STATUTS_A_RELANCER } from '@/lib/statuts';

// Action marchand dédiée "Colis à relancer" : contrairement à
// PATCH /api/commandes/{id}/statut (réservé admin/agent/livreur/sav), ce
// point d'entrée n'autorise qu'une seule transition ciblée, sur les seuls
// colis appartenant au marchand appelant et déjà en échec de livraison.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;

    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande || commande.marchandId !== marchand.id) {
      throw new ApiError(403, 'Accès refusé à cette commande');
    }

    if (!STATUTS_A_RELANCER.includes(commande.statut)) {
      throw new ApiError(400, 'Ce colis n\'est pas dans un statut permettant une relance');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id },
        data: { statut: 'attente_de_relancer' },
      });

      // RG-10 : historisation de chaque changement de statut.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: id,
          ancienStatut: commande.statut,
          nouveauStatut: 'attente_de_relancer',
          utilisateurId: session.sub,
        },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
