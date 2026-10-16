import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { filtreBonsDuTransporteur } from '@/lib/livreur';

// § /livreur/bons-envoi : les bons d'envoi confiés au transporteur dont ce
// compte est le compte humain — adressés à lui directement ou au hub régional
// qu'il tient (§ filtreBonsDuTransporteur). Contrairement à la feuille de
// route, la liste garde les bons soldés : c'est l'historique de ce qu'on lui a
// remis. Un livreur interne n'en a aucun et reçoit une liste vide.
export async function GET() {
  try {
    const session = await requireUser(['livreur']);
    const bons = await prisma.bonEnvoi.findMany({
      where: filtreBonsDuTransporteur(session.sub),
      include: {
        hubDestination: { select: { nom: true, prestataire: { select: { nom: true } } } },
        prestataire: { select: { id: true, nom: true } },
        _count: { select: { remisesPrestataire: { where: { active: true, etat: 'acceptee' } } } },
      },
      orderBy: { dateGeneration: 'desc' },
    });
    // Remis (§ estColisConfieRemis) : reçu, transmis, ou colis accepté par l'API.
    const data = bons.map(({ _count, ...b }) => ({
      ...b,
      remis: b.statut === 'recu' || !!b.dateTransmission || _count.remisesPrestataire > 0,
    }));
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
