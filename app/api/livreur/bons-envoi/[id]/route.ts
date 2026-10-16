import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { filtreBonsDuTransporteur } from '@/lib/livreur';

// § /livreur/bons-envoi/[id] : détail d'un bon confié au transporteur connecté.
// Le filtre de propriété est dans la requête elle-même : le bon d'un autre
// transporteur répond 404, comme un bon inexistant, sans dire qu'il existe.
// Seuls les champs utiles à la livraison sortent — ni l'état de paiement du
// marchand, ni qui a fait quoi chez nous.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['livreur']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findFirst({
      where: { AND: [{ id }, filtreBonsDuTransporteur(session.sub)] },
      select: {
        id: true,
        numero: true,
        statut: true,
        nbColis: true,
        dateGeneration: true,
        dateReception: true,
        dateTransmission: true,
        hubDestination: { select: { nom: true, prestataire: { select: { nom: true } } } },
        prestataire: { select: { id: true, nom: true } },
        commandes: {
          select: {
            id: true,
            codeSuivi: true,
            dateCreation: true,
            clientNom: true,
            clientTelephone: true,
            ville: true,
            adresse: true,
            montantCod: true,
            statut: true,
            notes: true,
            ouvrir: true,
            fragile: true,
            aRemplacer: true,
            produitDescription: true,
            marchand: { select: { nomBoutique: true } },
            marchandise: { select: { nom: true } },
            remisesPrestataire: { where: { active: true, etat: 'acceptee' }, select: { creeLe: true } },
          },
          orderBy: { codeSuivi: 'asc' },
        },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    // Remis (§ estColisConfieRemis) : reçu, transmis, ou au moins un colis
    // accepté par l'API — avec la date du premier de ces faits.
    const datesApi = bon.commandes.flatMap((c) => c.remisesPrestataire.map((r) => r.creeLe.getTime()));
    const remisLe =
      bon.dateReception ?? bon.dateTransmission ?? (datesApi.length ? new Date(Math.min(...datesApi)) : null);
    const commandes = bon.commandes.map(({ remisesPrestataire, ...c }) => ({ ...c, remis: bon.statut === 'recu' || !!bon.dateTransmission || remisesPrestataire.length > 0 }));
    return NextResponse.json({ ...bon, commandes, remis: remisLe !== null, remisLe });
  } catch (error) {
    return jsonError(error);
  }
}
