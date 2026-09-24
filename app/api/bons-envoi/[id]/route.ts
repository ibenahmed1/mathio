import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi, resolveUserHub, type CommandeEligibleEnvoi } from '@/lib/hub-envoi';
import { revaliderColisPrestataire } from '@/lib/bon-envoi-prestataire';
import type { StatutCommande } from '@/app/generated/prisma/enums';

// Le dénominateur commun des deux sources de colis ajoutables : de quoi écrire
// la ligne d'historique, sans dépendre de la forme complète d'une Commande.
type ColisAAjouter = { id: string; statut: StatutCommande; hubActuelId: string | null };

const bonEnvoiInclude = {
  // Le prestataire de l'agence de destination : c'est lui qui dit si le bon
  // peut être remis par une API de transporteur (§ Power Delivery).
  hubDestination: { select: { nom: true, prestataire: { select: { nom: true } } } },
  // Transporteur visé DIRECTEMENT (§ BonEnvoi.prestataireId) : renseigné à la
  // place de hubDestination sur un bon sous-traité, jamais en plus.
  prestataire: { select: { id: true, nom: true } },
  receptionnaire: { select: { nomComplet: true } },
  commandes: { include: { marchand: { select: { nomBoutique: true } } }, orderBy: { codeSuivi: 'asc' as const } },
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'agent_hub']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({ where: { id }, include: bonEnvoiInclude });

    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    // § Confinement agent_hub : ne peut consulter que les BE de son propre hub.
    if (session.role === 'agent_hub') {
      const hub = await resolveUserHub(session.sub);
      if (hub.id !== bon.hubDestinationId) throw new ApiError(403, 'Accès refusé');
    }

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}

// Modifie la composition d'un Bon d'Envoi encore 'nouveau' (admin only, cf.
// création elle-même admin only) : ajoute et/ou retire des colis. Un colis
// retiré retrouve le statut qu'il avait juste avant d'entrer en transit
// (relu depuis sa dernière entrée d'historique "-> en_transit" plutôt que
// deviné, car il peut venir soit de recu_au_hub soit de ramasse+enStock).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const ajouterColisIds = parseStringIdArray(body.ajouterColisIds);
    const retirerColisIds = parseStringIdArray(body.retirerColisIds);
    if (ajouterColisIds.length === 0 && retirerColisIds.length === 0) {
      throw new ApiError(400, 'Rien à modifier : sélectionnez au moins un colis à ajouter ou à retirer');
    }

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      include: {
        hubDestination: { select: { id: true, nom: true } },
        prestataire: { select: { nom: true } },
        commandes: true,
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");
    if (bon.statut !== 'nouveau') {
      throw new ApiError(409, "Ce Bon d'Envoi a déjà été reçu, il ne peut plus être modifié");
    }

    const aRetirer = bon.commandes.filter((c) => retirerColisIds.includes(c.id));
    if (aRetirer.length !== retirerColisIds.length) {
      throw new ApiError(400, "Un ou plusieurs colis à retirer ne font pas partie de ce Bon d'Envoi");
    }

    // Les colis ajoutables ne se cherchent pas au même endroit selon la nature
    // du bon : par routage ville → hub pour un transit interne, sans aucun
    // filtre géographique pour une remise sous-traitée.
    let aAjouter: ColisAAjouter[];
    if (bon.prestataire) {
      aAjouter = await revaliderColisPrestataire(ajouterColisIds, body.tousStatuts === true);
    } else {
      const eligiblesPourHub = new Map<string, CommandeEligibleEnvoi>(
        (await getColisEligiblesEnvoi())
          .filter((e) => e.hub.hubId === bon.hubDestinationId)
          .map((e) => [e.commande.id, e.commande])
      );
      aAjouter = ajouterColisIds
        .map((cid) => eligiblesPourHub.get(cid))
        .filter((c): c is CommandeEligibleEnvoi => Boolean(c));
      if (aAjouter.length !== ajouterColisIds.length) {
        throw new ApiError(409, "Un ou plusieurs colis à ajouter ne sont plus éligibles pour ce hub");
      }
    }

    // Retrouve, pour chaque colis à retirer, le statut à restaurer (celui
    // d'avant son entrée en transit dans CE bon, ou un autre auparavant).
    const statutRestaure = new Map<string, StatutCommande>();
    if (aRetirer.length > 0) {
      const historique = await prisma.historiqueStatutCommande.findMany({
        where: { commandeId: { in: aRetirer.map((c) => c.id) }, nouveauStatut: 'en_transit' },
        orderBy: { horodatage: 'desc' },
        select: { commandeId: true, ancienStatut: true },
      });
      for (const h of historique) {
        if (!statutRestaure.has(h.commandeId) && h.ancienStatut) {
          statutRestaure.set(h.commandeId, h.ancienStatut);
        }
      }
    }

    // § Comptes transporteurs : l'affectation posée à la composition du bon
    // (§ creerBonEnvoiPrestataire) doit SUIVRE ses mouvements. Un colis ajouté
    // revient au compte du transporteur, un colis retiré le perd — sans quoi
    // il resterait affecté à une société qui ne l'a jamais eu en main, et
    // apparaîtrait dans sa feuille de route le jour d'un autre bon.
    // Sur un TRANSIT INTERNE, en revanche, on ne touche pas à `livreurId` :
    // le colis n'a pas changé de mains, il change de quai. L'écraser ferait
    // perdre l'affectation d'un colis qui repart en tournée après son
    // transfert — une régression sans rapport avec ce lot.
    const affectationTransporteur: { livreurId?: string | null } = bon.prestataireId
      ? {
          livreurId:
            (
              await prisma.prestataire.findUnique({
                where: { id: bon.prestataireId },
                select: { compteLivreurId: true },
              })
            )?.compteLivreurId ?? null,
        }
      : {};

    await prisma.$transaction(async (tx) => {
      if (aAjouter.length > 0) {
        await tx.commande.updateMany({
          where: { id: { in: aAjouter.map((c) => c.id) } },
          data: { bonEnvoiId: bon.id, statut: 'en_transit', ...affectationTransporteur },
        });
        await tx.historiqueStatutCommande.createMany({
          data: aAjouter.map((c) => ({
            commandeId: c.id,
            ancienStatut: c.statut,
            nouveauStatut: 'en_transit' as const,
            utilisateurId: session.sub,
            // Sur un bon sous-traité il n'y a pas de hub d'arrivée : on note
            // celui d'où le colis part, pour que l'historique reste situé.
            hubId: bon.hubDestinationId ?? c.hubActuelId,
            note: bon.prestataire
              ? `Colis confié au transporteur ${bon.prestataire.nom} via le Bon d'Envoi ${bon.numero}`
              : `Colis intégré dans le Bon d'Envoi ${bon.numero} en transit vers ${bon.hubDestination?.nom}`,
          })),
        });
      }

      for (const c of aRetirer) {
        const restaure = statutRestaure.get(c.id) ?? 'recu_au_hub';
        await tx.commande.update({
          where: { id: c.id },
          // Retiré d'un bon sous-traité, le colis perd son affectation : il
          // n'est plus confié à personne. Retiré d'un transit interne, il
          // garde la sienne, pour la même raison qu'à l'ajout.
          data: { bonEnvoiId: null, statut: restaure, ...(bon.prestataireId ? { livreurId: null } : {}) },
        });
        await tx.historiqueStatutCommande.create({
          data: {
            commandeId: c.id,
            ancienStatut: 'en_transit',
            nouveauStatut: restaure,
            utilisateurId: session.sub,
            hubId: bon.hubDestinationId ?? c.hubActuelId,
            note: `Colis retiré du Bon d'Envoi ${bon.numero}`,
          },
        });
      }

      await tx.bonEnvoi.update({
        where: { id: bon.id },
        data: { nbColis: bon.commandes.length + aAjouter.length - aRetirer.length },
      });
    });

    const updated = await prisma.bonEnvoi.findUnique({ where: { id }, include: bonEnvoiInclude });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
