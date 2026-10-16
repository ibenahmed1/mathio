import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';

// § Circuit Shipeh (12/10/2026) — /admin/stock/prets : l'agent stock scanne un
// colis Shipeh préparé. C'est le SEUL geste qui le fait passer de
// « pret_pour_preparation » à « recu_au_hub » au hub central (Casablanca) ; il
// quitte alors les listes du stock pour la liste principale des colis, d'où il
// pourra entrer dans un bon d'envoi.
//
// Les colis stock de nos propres marchands ne passent pas ici : ils suivent
// toujours le bon de préparation.
//
// Idempotent : un second scan du même colis répond sans rien réécrire.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const codeSuivi = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    const hub = await prisma.hub.findFirst({ where: { isCentral: true }, select: { id: true, nom: true, ville: true } });
    if (!hub) throw new ApiError(500, 'Aucun hub central configuré (/admin/hubs)');

    const commande = await prisma.commande.findUnique({
      where: { codeSuivi },
      select: { id: true, codeSuivi: true, statut: true, source: true, enStock: true, hubActuelId: true, ville: true, clientNom: true },
    });
    if (!commande) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    if (commande.source !== 'api' || !commande.enStock) {
      throw new ApiError(409, `${codeSuivi} n'est pas un colis Shipeh : il suit le bon de préparation`);
    }
    if (commande.statut === 'recu_au_hub' && commande.hubActuelId === hub.id) {
      return NextResponse.json({ ...commande, hub, dejaScanne: true });
    }
    if (commande.statut !== 'pret_pour_preparation') {
      throw new ApiError(
        409,
        commande.statut === 'nouveau_colis'
          ? `${codeSuivi} n'est pas encore validé : validez-le d'abord dans « Nouveaux colis de stock »`
          : `${codeSuivi} est au statut « ${commande.statut} » : seul un colis prêt pour la préparation se scanne ici`
      );
    }

    const maintenant = new Date();
    const misAJour = await prisma.$transaction(async (tx) => {
      // Verrou optimiste : un double scan simultané n'écrit qu'une fois.
      const { count } = await tx.commande.updateMany({
        where: { id: commande.id, statut: 'pret_pour_preparation' },
        data: { statut: 'recu_au_hub', hubActuelId: hub.id, dateReceptionHub: maintenant },
      });
      if (count === 0) throw new ApiError(409, `${codeSuivi} vient d'être scanné par quelqu'un d'autre`);
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: commande.id,
          ancienStatut: 'pret_pour_preparation',
          nouveauStatut: 'recu_au_hub',
          utilisateurId: session.sub,
          hubId: hub.id,
          note: `Scanné au stock — reçu au ${hub.nom} (${hub.ville})`,
        },
      });
      return { ...commande, statut: 'recu_au_hub' as const, hubActuelId: hub.id };
    });

    return NextResponse.json({ ...misAJour, hub, dejaScanne: false });
  } catch (error) {
    return jsonError(error);
  }
}
