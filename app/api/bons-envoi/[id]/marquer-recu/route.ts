import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';

// § Clôture d'un Bon d'Envoi — deux gestes distincts derrière un même bouton,
// selon la nature du bon (§ BonEnvoi dans prisma/schema.prisma) :
//
//   TRANSIT INTERNE — réception par l'Agent du Hub destinataire (ou un admin
//     en dépannage) : le bon passe 'recu' et TOUS ses colis basculent
//     en_transit -> recu_au_hub d'un coup, puisqu'un bon ne vise qu'un seul
//     quai et qu'une seule action suffit donc à le clôturer.
//
//   REMISE SOUS-TRAITÉE — prise en charge par le transporteur : le bon passe
//     'recu', mais les colis RESTENT en_transit. Les basculer à recu_au_hub
//     dirait qu'ils sont arrivés sur un de nos quais, ce qui serait faux : ils
//     sont partis chez un tiers, et c'est lui qui nous dira ensuite ce qu'ils
//     deviennent (son API ou son fichier de suivi). Aucun hub n'est touché.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'agent_hub']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      include: {
        hubDestination: { select: { id: true, nom: true } },
        prestataire: { select: { nom: true } },
        commandes: true,
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    // § Confinement agent_hub. Un bon sous-traité n'a pas de hub d'arrivée :
    // la comparaison échoue d'elle-même, mais le message le dit explicitement
    // plutôt que de laisser croire à une erreur de hub.
    if (session.role === 'agent_hub') {
      if (bon.prestataire) {
        throw new ApiError(403, 'Un bon remis à un transporteur se clôture depuis le back-office');
      }
      const hub = await resolveUserHub(session.sub);
      if (hub.id !== bon.hubDestinationId) {
        throw new ApiError(403, "Ce Bon d'Envoi n'est pas destiné à votre hub");
      }
    }

    if (bon.statut !== 'nouveau') {
      throw new ApiError(409, "Ce Bon d'Envoi a déjà été marqué comme reçu");
    }

    const now = new Date();

    if (bon.prestataire) {
      const note = `Colis pris en charge par le transporteur ${bon.prestataire.nom} (Bon d'Envoi ${bon.numero})`;

      await prisma.$transaction(async (tx) => {
        await tx.bonEnvoi.update({
          where: { id: bon.id },
          data: { statut: 'recu', dateReception: now, receptionnaireId: session.sub },
        });

        // Statut inchangé de part et d'autre : la ligne d'historique ne
        // consigne pas un changement d'état du colis, elle consigne QUI l'a
        // désormais. Sans elle, rien ne daterait la remise.
        await tx.historiqueStatutCommande.createMany({
          data: bon.commandes.map((c) => ({
            commandeId: c.id,
            ancienStatut: c.statut,
            nouveauStatut: c.statut,
            utilisateurId: session.sub,
            hubId: c.hubActuelId,
            note,
          })),
        });
      });

      return NextResponse.json({ updated: bon.commandes.length });
    }

    const note = `Colis réceptionné au Hub ${bon.hubDestination?.nom} via le Bon d'Envoi ${bon.numero}`;

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
