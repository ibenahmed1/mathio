import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserPreuveComptable, nomFichierPreuve } from '@/lib/finance';

// Justificatif d'une écriture comptable (§ /admin/comptabilite).
//
// La photo vit en base, encodée en data URL dans `transactions.preuve_url`
// (§ Transaction.preuveUrl, faute de stockage objet dans ce projet). Le journal
// ne la transporte PAS : GET /api/finance l'écarte par `omit` et n'expose qu'un
// pointeur vers ici. C'est donc cette route qui sert l'octet, à la demande, une
// écriture à la fois — sinon ouvrir l'écran de comptabilité aurait rapatrié le
// base64 de toutes les écritures du journal.
//
// Droits : identiques à la consultation du journal, ni plus ni moins. Un
// justificatif n'est pas plus public que l'écriture qui le porte. Déjà couverte
// par la règle `/api/finance/**` → `comptabilite:read` (méthodes sûres) de
// lib/permission-routes.ts — pas d'entrée à ajouter, elle vaut pour les
// sous-routes.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_COMPTABILITE]);
    const { id } = await params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, preuveUrl: true },
    });
    if (!transaction) throw new ApiError(404, 'Transaction introuvable');
    // Une écriture sans justificatif n'est pas une anomalie (la preuve est
    // facultative) : c'est bien 404, la ressource demandée n'existe pas.
    if (!transaction.preuveUrl) throw new ApiError(404, 'Cette écriture n\'a pas de justificatif');

    const analyse = analyserPreuveComptable(transaction.preuveUrl);
    // Une ligne écrite avant la liste blanche actuelle, ou tronquée : on le dit
    // plutôt que de servir des octets qu'on ne sait plus qualifier.
    if (analyse.statut === 'refus') throw new ApiError(422, analyse.message);

    const octets = Buffer.from(analyse.preuve.base64, 'base64');
    return new NextResponse(new Uint8Array(octets), {
      headers: {
        'Content-Type': analyse.preuve.mime,
        'Content-Length': String(octets.byteLength),
        // `inline` : la visionneuse du journal affiche l'image sans la
        // télécharger. Le nom ne sert qu'au téléchargement explicite.
        'Content-Disposition': `inline; filename="${nomFichierPreuve(transaction.id, analyse.preuve.mime)}"`,
        // Un justificatif ne se modifie pas : l'écriture qui le porte est
        // immuable (on l'annule, on ne la corrige pas). Cache privé et non
        // partagé — le contenu est soumis aux droits de la comptabilité.
        'Cache-Control': 'private, max-age=31536000, immutable',
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
