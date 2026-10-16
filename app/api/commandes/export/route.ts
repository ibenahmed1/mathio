import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { chargerColisExcel, classeurColis, reponseExcel } from '@/lib/export-colis-excel';
import { buildCommandesWhere } from '@/lib/commandes-filters';
import { LABELS_STATUT_COMMANDE, LABELS_ETAT_PAIEMENT } from '@/lib/statuts';

// Export Excel des colis filtrés (mêmes filtres que GET /api/commandes),
// sans pagination — le marchand veut la liste complète correspondant à ses
// filtres, pas seulement la page affichée à l'écran.
const LIMITE_EXPORT = 10_000;

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { searchParams } = request.nextUrl;

    const where = await buildCommandesWhere(searchParams, session);

    const commandes = await prisma.commande.findMany({
      where,
      include: {
        livreur: { select: { nomComplet: true } },
        marchandise: { select: { nom: true } },
      },
      orderBy: { dateCreation: 'desc' },
      take: LIMITE_EXPORT,
    });

    const lignes = commandes.map((c) => ({
      'Code d\'envoi': c.codeSuivi,
      Destinataire: c.clientNom,
      Téléphone: c.clientTelephone,
      Marchandise: c.marchandise?.nom ?? c.produitDescription ?? '',
      Ville: c.ville,
      Adresse: c.adresse,
      'Prix (DH)': Number(c.montantCod),
      Statut: LABELS_STATUT_COMMANDE[c.statut] ?? c.statut,
      'État paiement': LABELS_ETAT_PAIEMENT[c.etatPaiement] ?? c.etatPaiement,
      Livreur: c.livreur?.nomComplet ?? '',
      'Date création': c.dateCreation.toLocaleString('fr-FR'),
      'Date collecte': c.dateCollecte ? c.dateCollecte.toLocaleString('fr-FR') : '',
      'Date livraison': c.dateLivraison ? c.dateLivraison.toLocaleString('fr-FR') : '',
      Notes: c.notes ?? '',
    }));

    const feuille = XLSX.utils.json_to_sheet(lignes);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, 'Colis');
    const buffer = XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const nomFichier = `colis-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nomFichier}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

// Export des colis COCHÉS dans une liste du back-office (colis, stock, BE
// exceptionnel), au format validé du 14/10/2026 — celui des bons d'envoi
// (lib/export-colis-excel.ts). Fermé au marchand : une liste d'identifiants
// arbitraires lui ouvrirait les colis des autres.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();
    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) throw new ApiError(400, 'Sélectionnez au moins un colis');
    if (colisIds.length > LIMITE_EXPORT) throw new ApiError(400, `${LIMITE_EXPORT} colis au plus par export`);
    const colis = await chargerColisExcel(colisIds);
    if (colis.length !== colisIds.length) throw new ApiError(409, 'Un ou plusieurs colis sont introuvables');
    return reponseExcel(classeurColis(colis), `colis-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (error) {
    return jsonError(error);
  }
}
