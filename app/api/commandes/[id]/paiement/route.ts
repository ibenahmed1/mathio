import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { EtatPaiement } from '@/app/generated/prisma/enums';

// Cycle de règlement du COD, distinct du statut de livraison :
// non_paye -> facture -> paye, avec "rembourse" atteignable depuis facture/paye
// (action admin "Remboursement" — COD restitué). Réservé à responsable/admin
// (reprend le périmètre de l'ancien rôle finance) et superviseur (portée
// large) — le marchand ne facture/paye pas lui-même sa propre commande.
const TRANSITIONS: Record<EtatPaiement, EtatPaiement[]> = {
  non_paye: ['facture'],
  facture: ['paye', 'rembourse'],
  paye: ['rembourse'],
  rembourse: [],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['responsable', 'admin', 'superviseur']);
    const { id } = await params;
    const body = await request.json();
    const nouvelEtat = body.etatPaiement as EtatPaiement | undefined;

    if (!nouvelEtat) {
      throw new ApiError(400, 'Le champ etatPaiement est requis');
    }

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    if (!TRANSITIONS[commande.etatPaiement]?.includes(nouvelEtat)) {
      throw new ApiError(400, `Transition invalide : ${commande.etatPaiement} → ${nouvelEtat}`);
    }

    const updated = await prisma.commande.update({
      where: { id },
      data: { etatPaiement: nouvelEtat },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
