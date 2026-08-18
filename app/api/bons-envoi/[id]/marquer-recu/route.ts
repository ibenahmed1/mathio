import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';

// § Réception d'un Bon d'Envoi par l'Agent du Hub Destinataire (ou un admin
// en dépannage) : le BE passe 'recu' et TOUS ses colis basculent
// en_transit -> recu_au_hub d'un coup (cf. commentaire sur BonEnvoi dans
// prisma/schema.prisma : un BE ne vise qu'un seul hub, donc une seule
// action de réception suffit à le clôturer entièrement).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'agent_hub']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      include: { hubDestination: { select: { id: true, nom: true } }, commandes: true },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    if (session.role === 'agent_hub') {
      const hub = await resolveUserHub(session.sub);
      if (hub.id !== bon.hubDestinationId) {
        throw new ApiError(403, "Ce Bon d'Envoi n'est pas destiné à votre hub");
      }
    }

    if (bon.statut !== 'nouveau') {
      throw new ApiError(409, "Ce Bon d'Envoi a déjà été marqué comme reçu");
    }

    const now = new Date();
    const note = `Colis réceptionné au Hub ${bon.hubDestination.nom} via le Bon d'Envoi ${bon.numero}`;

    await prisma.$transaction(async (tx) => {
      await tx.bonEnvoi.update({
        where: { id: bon.id },
        data: { statut: 'recu', dateReception: now, receptionnaireId: session.sub },
      });

      await tx.commande.updateMany({
        where: { id: { in: bon.commandes.map((c) => c.id) } },
        data: { statut: 'recu_au_hub', hubActuelId: bon.hubDestinationId, dateReceptionHub: now },
      });

      await tx.historiqueStatutCommande.createMany({
        data: bon.commandes.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'recu_au_hub' as const,
          utilisateurId: session.sub,
          hubId: bon.hubDestinationId,
          note,
        })),
      });
    });

    return NextResponse.json({ updated: bon.commandes.length });
  } catch (error) {
    return jsonError(error);
  }
}
