import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserPreuveComptable, nomFichierPreuve } from '@/lib/finance';

// Justificatif d'une commande d'inventaire (§ /admin/comptabilite, carte
// « Commandes d'inventaire »).
//
// Pendant exact de app/api/finance/[id]/preuve/route.ts — voir ce fichier pour
// le raisonnement complet. En bref : la photo vit en base en data URL
// (§ CommandeStockHub.preuveUrl), la liste des commandes l'écarte par `omit` et
// n'expose qu'un pointeur, et c'est ici qu'elle est servie à la demande, une
// commande à la fois.
//
// Droits : identiques à la consultation de la liste. Déjà couverte par la règle
// `/api/commandes-stock-hub/**` → `comptabilite:read` (méthodes sûres) de
// lib/permission-routes.ts — pas d'entrée à ajouter, elle vaut pour les
// sous-routes.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);
    const { id } = await params;

    const commande = await prisma.commandeStockHub.findUnique({
      where: { id },
      select: { id: true, numero: true, preuveUrl: true },
    });
    if (!commande) throw new ApiError(404, 'Commande introuvable');
    // Une commande sans justificatif n'est pas une anomalie (la preuve est
    // facultative) : c'est bien 404, la ressource demandée n'existe pas.
    if (!commande.preuveUrl) throw new ApiError(404, 'Cette commande n\'a pas de justificatif');

    const analyse = analyserPreuveComptable(commande.preuveUrl);
    // Une ligne écrite avant la liste blanche actuelle, ou tronquée : on le dit
    // plutôt que de servir des octets qu'on ne sait plus qualifier.
    if (analyse.statut === 'refus') throw new ApiError(422, analyse.message);

    const octets = Buffer.from(analyse.preuve.base64, 'base64');
    return new NextResponse(new Uint8Array(octets), {
      headers: {
        'Content-Type': analyse.preuve.mime,
        'Content-Length': String(octets.byteLength),
        // Le nom porte le numéro de bordereau (BC-…) et non l'UUID : c'est sous
        // cette référence que la pièce sera classée dans un dossier comptable.
        'Content-Disposition': `inline; filename="${nomFichierPreuve(`BC-${commande.numero}`, analyse.preuve.mime)}"`,
        // Remplaçable à la même adresse (PATCH /api/commandes-stock-hub/[id]) :
        // pas de cache long, même raison que le justificatif d'une écriture.
        'Cache-Control': 'private, no-cache',
        // Ceinture et bretelles avec la liste blanche de formats : rien de ce
        // qui sort d'ici ne doit être deviné ni exécuté par le navigateur.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
