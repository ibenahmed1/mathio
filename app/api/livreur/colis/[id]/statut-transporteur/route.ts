import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { estColisConfieRemis, sortiDeTournee } from '@/lib/livreur';
import { analyserEntreeStatut, deciderTransition, ecrireTransition } from '@/lib/livraison-statut';

// POST /api/livreur/colis/[id]/statut-transporteur — un transporteur déclare,
// depuis son espace, l'un des statuts du catalogue de SA documentation API
// (CATALOGUE_STATUTS_PRESTATAIRE, GET /api/v1/statuts). C'est la saisie de
// secours quand son API est en panne : mêmes statuts, même date exigée pour
// « reporté » / « programmé », même note de 150 caractères, et surtout même
// règle et même écriture que POST /api/v1/livraisons/statut (colis clos
// refusé, rejeu sans effet, historique, notification, créance). Une règle,
// deux portes.
//
// Réservé aux colis d'un bon d'envoi pris en charge par ce transporteur, et
// seulement si le back-office lui a ouvert la saisie
// (Prestataire.saisieStatutsActive, Équipe › Rôles & permissions).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['livreur']);
    const { id } = await params;
    const body = await request.json();

    const commande = await prisma.commande.findUnique({
      where: { id },
      select: {
        id: true,
        codeSuivi: true,
        statut: true,
        livreurId: true,
        bonDistributionId: true,
        bonDistribution: { select: { statut: true, dateGeneration: true } },
        remisesPrestataire: { where: { active: true, etat: 'acceptee' }, select: { id: true } },
        bonEnvoi: {
          select: {
            statut: true,
            dateGeneration: true,
            dateTransmission: true,
            prestataire: { select: { nom: true, compteLivreurId: true, saisieStatutsActive: true } },
            hubDestination: {
              select: { prestataire: { select: { nom: true, compteLivreurId: true, saisieStatutsActive: true } } },
            },
          },
        },
      },
    });
    if (!commande) throw new ApiError(404, 'Colis introuvable');

    // Le bon dit à quel transporteur le colis est confié (§ filtreBonsDuTransporteur).
    const prestataire = commande.bonEnvoi?.prestataire ?? commande.bonEnvoi?.hubDestination?.prestataire ?? null;
    if (!sortiDeTournee(commande) || !prestataire || prestataire.compteLivreurId !== session.sub) {
      throw new ApiError(403, 'Ce colis ne vous est pas confié');
    }
    if (!estColisConfieRemis({ ...commande, bonDistributionId: null })) {
      throw new ApiError(409, "Ce colis ne vous a pas encore été remis : il n'est pas modifiable depuis l'application.");
    }
    if (!prestataire.saisieStatutsActive) {
      throw new ApiError(403, 'La saisie des statuts depuis votre espace est désactivée : vos statuts nous parviennent par votre API');
    }

    // Même validation que l'API : statut du catalogue, date ISO si exigée, note bornée.
    const entree = analyserEntreeStatut({ codeSuivi: commande.codeSuivi, statut: body.statut, date: body.date, note: body.note });

    const decision = deciderTransition(commande.statut, entree.statut);
    if (decision.issue === 'refuse') throw new ApiError(409, decision.message);
    if (decision.issue === 'inchange') {
      return NextResponse.json({ issue: 'inchange', statut: commande.statut });
    }

    const nouveauStatut = entree.statut.statut;
    const issue = await ecrireTransition({
      commandeId: commande.id,
      statutActuel: commande.statut,
      nouveauStatut,
      auteurId: session.sub,
      noteHistorique:
        `${entree.statut.libelle} — déclaré par ${prestataire.nom} depuis son espace` +
        (entree.date ? ` — prochaine tentative le ${entree.date.toLocaleDateString('fr-FR')}` : ''),
      dateNouvelleLivraison: entree.date,
      commentaire: entree.note,
    });

    // Affectation réalignée sur le bon (statistiques et caisse se lisent par
    // `livreurId`) ; preuve de livraison jointe si le transporteur en a pris une.
    const photoPreuveUrl = typeof body.photoPreuveUrl === 'string' ? body.photoPreuveUrl : undefined;
    const signatureUrl = typeof body.signatureUrl === 'string' ? body.signatureUrl : undefined;
    if (commande.livreurId !== session.sub || (nouveauStatut === 'livre' && (photoPreuveUrl || signatureUrl))) {
      await prisma.commande.update({
        where: { id: commande.id },
        data: {
          livreurId: session.sub,
          ...(nouveauStatut === 'livre' && { photoPreuveUrl, signatureUrl }),
        },
      });
    }

    return NextResponse.json({ issue, statut: nouveauStatut });
  } catch (error) {
    return jsonError(error);
  }
}
