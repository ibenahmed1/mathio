import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserPreuveComptable, nomFichierPreuve } from '@/lib/finance';

// Photo du reçu d'un versement, servie à la demande (jamais dans une liste) —
// mêmes en-têtes que les justificatifs du journal (GET /api/finance/[id]/preuve).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const v = await prisma.versementTransporteur.findUnique({ where: { id }, select: { id: true, preuveUrl: true } });
    if (!v?.preuveUrl) throw new ApiError(404, 'Pas de photo pour ce versement');
    const analyse = analyserPreuveComptable(v.preuveUrl);
    if (analyse.statut === 'refus') throw new ApiError(422, analyse.message);
    const octets = Buffer.from(analyse.preuve.base64, 'base64');
    return new NextResponse(new Uint8Array(octets), {
      headers: {
        'Content-Type': analyse.preuve.mime,
        'Content-Length': String(octets.byteLength),
        'Content-Disposition': `inline; filename="${nomFichierPreuve(v.id, analyse.preuve.mime)}"`,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
