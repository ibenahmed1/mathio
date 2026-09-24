import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { estVilleLocaleAuHub, getColisEligiblesEnvoi } from '@/lib/hub-envoi';
import { statutsEligiblesPrestataire } from '@/lib/bon-envoi-prestataire';

// § Étape 3 de la création d'un Bon d'Envoi, mode "scan" : résout un
// codeSuivi/QR (même logique que POST /api/commandes/scan-reception) et
// vérifie son éligibilité pour la cible choisie. Ne mute rien — le panier de
// colis à inclure reste géré côté client jusqu'à POST /api/bons-envoi.
//
// Comme partout dans ce module, la cible est soit un hub (transit interne,
// éligibilité imposée par la ville), soit un transporteur (remise
// sous-traitée, où seul compte l'état du colis).
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const hubDestinationId = typeof body.hubDestinationId === 'string' ? body.hubDestinationId.trim() : '';
    const prestataireId = typeof body.prestataireId === 'string' ? body.prestataireId.trim() : '';
    if (!hubDestinationId && !prestataireId) {
      throw new ApiError(400, 'hubDestinationId ou prestataireId est requis');
    }

    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
    let codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim().toUpperCase() : '';

    if (qrPayload) {
      const result = validateQrPayload(qrPayload);
      if (!result.valid || result.parcelId === undefined) {
        throw new ApiError(400, result.reason ?? 'QR code invalide');
      }
      codeSuivi = `PD-${String(result.parcelId).padStart(6, '0')}`;
    }

    if (!codeSuivi) {
      throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
    }

    // Mode transporteur : aucune contrainte de ville, donc la vérification se
    // réduit à l'état du colis. Les deux refus possibles sont nommés, plutôt
    // que fondus dans un « non éligible » qui n'apprend rien à l'opérateur.
    if (prestataireId) {
      const commande = await prisma.commande.findUnique({
        where: { codeSuivi },
        include: { marchand: { select: { nomBoutique: true } } },
      });
      if (!commande) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
      if (commande.bonEnvoiId) {
        throw new ApiError(409, "Ce colis est déjà inclus dans un autre Bon d'Envoi.");
      }
      if (!statutsEligiblesPrestataire(true).includes(commande.statut)) {
        throw new ApiError(409, `Ce colis est « ${commande.statut} » : son parcours est terminé, il ne peut plus être expédié.`);
      }
      return NextResponse.json(commande);
    }

    const eligibles = await getColisEligiblesEnvoi();
    const match = eligibles.find((e) => e.commande.codeSuivi === codeSuivi);

    if (!match) {
      const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
      if (!commande) {
        throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
      }
      if (commande.bonEnvoiId) {
        throw new ApiError(409, "Ce colis est déjà inclus dans un autre Bon d'Envoi.");
      }
      // § Colis dont la ville relève déjà du hub où il se trouve : ne relève
      // jamais d'un Bon d'Envoi, quel que soit son statut — message dédié
      // plutôt que le générique "non éligible", pour rediriger l'agent vers
      // le bon module.
      if (await estVilleLocaleAuHub(commande)) {
        throw new ApiError(
          409,
          "Colis à destination locale. Veuillez l'affecter directement à un Bon de Distribution."
        );
      }
      throw new ApiError(
        409,
        `Ce colis (statut "${commande.statut}", ville "${commande.ville}") n'est pas éligible à un transit.`
      );
    }

    if (match.hub.hubId !== hubDestinationId) {
      throw new ApiError(409, `Ce colis est destiné au hub ${match.hub.hubNom}, pas à celui sélectionné.`);
    }

    return NextResponse.json(match.commande);
  } catch (error) {
    return jsonError(error);
  }
}
