import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { parseReglement, reglerFacture } from '@/lib/facturation';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// EMISE → PAYEE : reversement effectif au marchand. La facture porte désormais
// le mode et la référence du paiement, ses colis passent à l'état `paye`, et
// une écriture comptable de sortie de caisse est générée — exactement le
// pendant du décaissement d'un bon de paiement livreur, mais en catégorie
// `paiement_client`.
//
// Le passage direct depuis BROUILLON est refusé : c'est l'émission qui fige le
// montant, et payer un brouillon reviendrait à décaisser une somme encore
// modifiable. La seule exception vit à la création (POST /api/factures avec
// `finaliser: 'payee'`), où l'utilisateur a le détail sous les yeux et arrête
// les deux étapes d'un même geste.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_FACTURATION]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const { modeReglement, referenceReglement } = parseReglement(body);

    const facture = await prisma.facture.findUnique({
      where: { id },
      select: { id: true, statut: true },
    });
    if (!facture) throw new ApiError(404, 'Facture introuvable');
    if (facture.statut === 'payee') throw new ApiError(409, 'Cette facture est déjà réglée');
    if (facture.statut === 'annulee') throw new ApiError(409, 'Cette facture est annulée');
    if (facture.statut === 'brouillon') {
      throw new ApiError(
        409,
        'Émettez la facture avant de la régler : un brouillon peut encore être modifié.'
      );
    }

    const reglee = await prisma.$transaction((tx) =>
      reglerFacture(tx, {
        factureId: id,
        auteurId: session.sub,
        modeReglement,
        referenceReglement,
      })
    );

    return NextResponse.json(reglee);
  } catch (error) {
    return jsonError(error);
  }
}
