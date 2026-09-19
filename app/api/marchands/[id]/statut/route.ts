import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { StatutMarchand } from '@/app/generated/prisma/enums';

const STATUTS_VALIDES: StatutMarchand[] = ['en_attente_validation', 'actif', 'suspendu'];

// RF-22 : approbation/refus/suspension d'un compte marchand par l'admin.
//
// Synchronise Utilisateur.actif, qui gouverne la CONNEXION — et seulement
// elle. Depuis l'inscription progressive, `en_attente_validation` n'est plus
// une porte fermée : le marchand se connecte, voit son dashboard, saisit ses
// colis. Seule la suspension coupe l'accès, parce qu'elle est une décision
// prise contre le compte. Ce que l'approbation ouvre vraiment, ce sont les
// bons, les ramassages et les factures (lib/marchand-activation.ts), fermés
// tant que le statut n'est pas "actif".
//
// Remettre un marchand approuvé en `en_attente_validation` referme donc ces
// fonctions sans l'expulser de son espace — c'est voulu.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const statut = body.statut as StatutMarchand | undefined;

    if (!statut || !STATUTS_VALIDES.includes(statut)) {
      throw new ApiError(400, `Statut invalide. Valeurs possibles : ${STATUTS_VALIDES.join(', ')}`);
    }

    const marchand = await prisma.marchand.findUnique({ where: { id } });
    if (!marchand) {
      throw new ApiError(404, 'Marchand introuvable');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.marchand.update({ where: { id }, data: { statut } });
      await tx.utilisateur.update({
        where: { id: marchand.utilisateurId },
        data: { actif: statut !== 'suspendu' },
      });
      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
