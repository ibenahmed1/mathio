import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';

// Export Excel d'un Bon d'Envoi (même pattern que GET /api/commandes/export).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      include: {
        hubDestination: { select: { nom: true } },
        commandes: { include: { marchand: { select: { nomBoutique: true } } }, orderBy: { codeSuivi: 'asc' } },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    const lignes = bon.commandes.map((c) => ({
      "Code d'envoi": c.codeSuivi,
      Marchand: c.marchand?.nomBoutique ?? '',
      Destinataire: c.clientNom,
      Téléphone: c.clientTelephone,
      Ville: c.ville,
      'Montant COD (DH)': Number(c.montantCod),
      Statut: LABELS_STATUT_COMMANDE[c.statut] ?? c.statut,
    }));

    const feuille = XLSX.utils.json_to_sheet(lignes);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, 'Colis');
    const buffer = XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${bon.numero}.xlsx"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
