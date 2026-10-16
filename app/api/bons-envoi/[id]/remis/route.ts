import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { chargerResolveurTransporteur } from '@/lib/hub-envoi';
import { attendRemise, noteEnTransit } from '@/lib/circuit-shipeh';

// § Circuit Shipeh (12/10/2026) — « Colis remis au transporteur » : le pendant
// manuel de la remise par API, pour un transporteur auquel nous ne sommes pas
// connectés (Amir, Sahario, Leader…) ou pour un colis que l'API a refusé. Le
// bon a été exporté en Excel et transmis : ses colis Shipeh encore au hub de
// départ passent « En transit » vers le hub de destination.
//
// Les autres colis du bon sont déjà en transit depuis leur entrée dans le bon.
// Depuis le 16/10/2026, la transmission est aussi DATÉE sur le bon, pour tous
// ses colis : c'est elle qui les fait apparaître comme remis dans l'espace du
// transporteur (§ estColisConfieRemis, lib/livreur.ts), sans attendre « Bon bien
// reçu ». Ouverte à tout bon non reçu, une seule fois.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      select: {
        id: true,
        numero: true,
        statut: true,
        dateTransmission: true,
        hubDestination: { select: { nom: true } },
        prestataire: { select: { nom: true } },
        commandes: { select: { id: true, codeSuivi: true, statut: true, source: true, enStock: true, ville: true, villeId: true, hubActuelId: true } },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");
    if (bon.statut !== 'nouveau') throw new ApiError(409, "Ce Bon d'Envoi a déjà été marqué comme reçu");

    if (bon.dateTransmission) throw new ApiError(409, 'Ce bon a déjà été marqué comme transmis');
    if (bon.commandes.length === 0) throw new ApiError(409, 'Ce bon ne contient aucun colis');
    const aRemettre = bon.commandes.filter(attendRemise);

    const resoudre = await chargerResolveurTransporteur();
    const destinataire = bon.prestataire?.nom ?? bon.hubDestination?.nom ?? 'le transporteur';

    const remis = await prisma.$transaction(async (tx) => {
      // Verrou optimiste : un double clic ne transmet qu'une fois.
      const date = await tx.bonEnvoi.updateMany({
        where: { id: bon.id, statut: 'nouveau', dateTransmission: null },
        data: { dateTransmission: new Date(), transmisParId: session.sub },
      });
      if (date.count !== 1) throw new ApiError(409, 'Ce bon vient d’être transmis ou reçu — rechargez la page');
      if (aRemettre.length === 0) return 0;
      const { count } = await tx.commande.updateMany({
        where: { id: { in: aRemettre.map((c) => c.id) }, statut: 'recu_au_hub', bonEnvoiId: bon.id },
        data: { statut: 'en_transit' },
      });
      if (count !== aRemettre.length) {
        throw new ApiError(409, 'Un ou plusieurs colis viennent de changer de statut — rechargez la page');
      }
      await tx.historiqueStatutCommande.createMany({
        data: aRemettre.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'en_transit' as const,
          utilisateurId: session.sub,
          hubId: c.hubActuelId,
          note: `Remis à ${destinataire} (Bon d'Envoi ${bon.numero}, export Excel) — ${noteEnTransit(
            bon.hubDestination?.nom ?? resoudre(c)?.hubNom ?? null
          )}`,
        })),
      });
      return count;
    });

    return NextResponse.json({ remis, transmis: bon.commandes.length });
  } catch (error) {
    return jsonError(error);
  }
}
