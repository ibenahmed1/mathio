import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import {
  chargerResolveurTransporteur,
  estVilleLocaleAuHub,
  getColisEligiblesEnvoi,
  refusTransporteur,
} from '@/lib/hub-envoi';
import { statutsEligiblesPrestataire } from '@/lib/bon-envoi-prestataire';
import { perimetreEnvoi, refusPerimetreEnvoi, refusShipehNonScanne } from '@/lib/circuit-shipeh';

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
    const session = await requireUser(['admin']);
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

    // § Circuit Shipeh : un colis Shipeh non scanné par l'agent stock est refusé
    // dans les deux modes, avec la raison.
    const brut = await prisma.commande.findUnique({
      where: { codeSuivi },
      select: { codeSuivi: true, statut: true, source: true, enStock: true, bonEnvoiId: true },
    });
    const refusShipeh = brut && !brut.bonEnvoiId ? refusShipehNonScanne(brut) : null;
    if (refusShipeh) throw new ApiError(409, refusShipeh);
    // L'agent stock n'envoie que des colis Shipeh scannés au Hub Central.
    const refusPerimetre = brut ? refusPerimetreEnvoi(session.role, brut) : null;
    if (refusPerimetre) throw new ApiError(409, refusPerimetre);

    // Mode transporteur : le colis doit être libre, dans un statut expédiable,
    // hors tournée, ET partir chez CE transporteur (§ refusTransporteur). Chaque
    // refus est nommé, plutôt que fondu dans un « non éligible » qui
    // n'apprend rien à l'opérateur.
    if (prestataireId) {
      const prestataire = await prisma.prestataire.findUnique({
        where: { id: prestataireId },
        select: { id: true, nom: true },
      });
      if (!prestataire) throw new ApiError(400, 'Transporteur introuvable');

      const commande = await prisma.commande.findUnique({
        where: { codeSuivi },
        include: {
          marchand: { select: { nomBoutique: true } },
          bonDistribution: { select: { numero: true, statut: true } },
        },
      });
      if (!commande) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
      if (commande.bonEnvoiId) {
        throw new ApiError(409, "Ce colis est déjà inclus dans un autre Bon d'Envoi.");
      }
      if (commande.bonDistribution && commande.bonDistribution.statut !== 'cloture') {
        throw new ApiError(409, `Ce colis est en tournée (${commande.bonDistribution.numero}) : il ne peut pas être confié à un transporteur.`);
      }
      // Même liste de statuts que celle que le serveur revalidera à
      // l'enregistrement — sinon un colis accepté au scan serait refusé au clic.
      if (!statutsEligiblesPrestataire(body.tousStatuts === true).includes(commande.statut)) {
        throw new ApiError(409, `Ce colis est « ${commande.statut} » : il ne peut pas être expédié dans ce bon.`);
      }
      const refus = refusTransporteur(commande, (await chargerResolveurTransporteur())(commande), prestataire);
      if (refus) throw new ApiError(409, refus);

      const { bonDistribution: _bd, ...colis } = commande;
      void _bd;
      return NextResponse.json(colis);
    }

    const eligibles = await getColisEligiblesEnvoi(perimetreEnvoi(session.role));
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
      if (!(await chargerResolveurTransporteur())(commande)) {
        throw new ApiError(
          409,
          `Colis ${commande.codeSuivi} : la ville « ${commande.ville} » n'est desservie par aucun transporteur. Corrigez la ville du colis avant de l'expédier.`
        );
      }
      throw new ApiError(
        409,
        `Ce colis (statut "${commande.statut}", ville "${commande.ville}") n'est pas prêt pour un transit : il doit d'abord être réceptionné au hub.`
      );
    }

    if (match.hub.hubId !== hubDestinationId) {
      const prevu = (await chargerResolveurTransporteur())(match.commande);
      throw new ApiError(
        409,
        `Colis ${match.commande.codeSuivi} (${match.commande.ville}) : il part vers ${match.hub.hubNom}${
          prevu?.prestataireNom ? ` (${prevu.prestataireNom})` : ''
        }, pas vers le hub de ce bon. Il ne peut pas y entrer.`
      );
    }

    return NextResponse.json(match.commande);
  } catch (error) {
    return jsonError(error);
  }
}
