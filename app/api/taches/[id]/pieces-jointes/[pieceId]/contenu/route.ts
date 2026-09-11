import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_BACKOFFICE_TACHES, boardsVisibles, exigerTacheAutorisee } from '@/lib/taches-scope';
import { analyserPieceJointe, nomTelechargeable } from '@/lib/pieces-jointes';

// Contenu d'une pièce jointe (§ /admin/tasks).
//
// Les fichiers déposés vivent en base, encodés en data URL dans la colonne
// `url` (§ lib/pieces-jointes.ts). La liste des pièces ne les transporte pas —
// elle n'en renvoie que l'en-tête et un pointeur vers ici — sinon ouvrir une
// fiche aurait rapatrié plusieurs mégaoctets de base64 à chaque fois. C'est
// donc cette route qui sert l'octet, à la demande, et sous le même périmètre
// que la tâche : une pièce n'est pas plus publique que le board qui la porte.
//
// Couverte par la règle `/api/taches/**` → `tasks:manage` de
// lib/permission-routes.ts, comme le reste des sous-routes de tâche.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; pieceId: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    const { id, pieceId } = await params;

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    exigerTacheAutorisee(session, await boardsVisibles(session), tache);

    const piece = await prisma.pieceJointeTache.findUnique({
      where: { id: pieceId },
      select: { tacheId: true, nom: true, url: true },
    });
    if (!piece || piece.tacheId !== id) throw new ApiError(404, 'Pièce jointe introuvable');

    const analyse = analyserPieceJointe(piece.url);
    // Une ligne écrite avant la liste blanche actuelle, ou tronquée : on le
    // dit plutôt que de servir des octets qu'on ne sait plus qualifier.
    if (analyse.statut === 'refus') throw new ApiError(422, analyse.message);

    // Lien externe : on renvoie vers la cible. Le back-office n'a pas à
    // devenir un proxy vers le web — relayer la réponse ferait porter à notre
    // origine le contenu d'un tiers.
    if (analyse.piece.kind === 'lien') return NextResponse.redirect(analyse.piece.url, 307);

    const octets = Buffer.from(analyse.piece.base64, 'base64');
    return new NextResponse(new Uint8Array(octets), {
      headers: {
        'Content-Type': analyse.piece.mime,
        'Content-Length': String(octets.byteLength),
        // `inline` : les images s'affichent dans la fiche et les PDF s'ouvrent
        // dans le lecteur du navigateur. Le nom ne sert qu'au téléchargement.
        'Content-Disposition': `inline; filename="${nomTelechargeable(piece.nom, analyse.piece.mime)}"`,
        // Une pièce jointe ne se modifie pas — on la remplace, et la nouvelle
        // a un autre identifiant. Cache privé et non partagé : le contenu est
        // soumis au périmètre du board.
        'Cache-Control': 'private, max-age=31536000, immutable',
        // Ceinture et bretelles avec la liste blanche de mimes : rien de ce
        // qui sort d'ici ne doit être deviné ni exécuté par le navigateur.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
