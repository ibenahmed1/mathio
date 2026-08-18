import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveBonDistributionAutorise } from '@/lib/bon-distribution';

// § Clôture de tournée : le Planner contrôle l'argent remis contre les
// livraisons déclarées, il doit donc pouvoir ouvrir la preuve (photo /
// signature) d'un colis livré. Endpoint dédié plutôt qu'un élargissement de
// GET /api/commandes/[id] au rôle planner : celui-ci expose toute la fiche
// colis (client, marchand, historique, notes internes) alors que le planner
// n'a besoin que des deux images, et uniquement pour un colis de SA tournée.
//
// Chargé à la demande, colis par colis, plutôt qu'embarqué dans le bilan :
// une preuve est une data URL de plusieurs centaines de Ko, les inclure
// toutes rendrait le rafraîchissement de l'écran de clôture inutilisable.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;

    const bon = await resolveBonDistributionAutorise(session, id);

    const commandeId = request.nextUrl.searchParams.get('commandeId')?.trim();
    if (!commandeId) {
      throw new ApiError(400, 'commandeId est requis');
    }

    const commande = await prisma.commande.findUnique({
      where: { id: commandeId },
      select: {
        bonDistributionId: true,
        codeSuivi: true,
        photoPreuveUrl: true,
        signatureUrl: true,
        dateLivraison: true,
      },
    });
    if (!commande || commande.bonDistributionId !== bon.id) {
      throw new ApiError(404, "Ce colis n'appartient pas à cette tournée");
    }

    return NextResponse.json({
      codeSuivi: commande.codeSuivi,
      photoPreuveUrl: commande.photoPreuveUrl,
      signatureUrl: commande.signatureUrl,
      dateLivraison: commande.dateLivraison,
    });
  } catch (error) {
    return jsonError(error);
  }
}
