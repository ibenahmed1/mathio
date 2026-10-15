import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Export Excel d'un Bon d'Envoi : le fichier transmis au transporteur (étape 1
// du bandeau de transmission). Colonnes et ordre fixés par l'exploitation le
// 14/10/2026 — c'est le format attendu par les transporteurs, n'en ajouter
// aucune sans leur accord.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      include: {
        hubDestination: { select: { nom: true } },
        commandes: {
          include: {
            produit: { select: { nom: true } },
            lignes: { select: { libelle: true, quantite: true }, orderBy: { position: 'asc' } },
          },
          orderBy: { codeSuivi: 'asc' },
        },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    const lignes = bon.commandes.map((c) => {
      // Colis multi-produits : une cellule « libellé ×quantité, … » et la
      // quantité totale ; sinon le produit unique du colis.
      const multi = c.lignes.length > 0;
      const produit = multi
        ? c.lignes.map((l) => `${l.libelle} ×${l.quantite}`).join(', ')
        : (c.produitDescription ?? c.produit?.nom ?? '');
      const quantite = multi ? c.lignes.reduce((n, l) => n + l.quantite, 0) : c.quantite;
      return {
        'Code Suivi': c.codeSuivi,
        'Nom du Destinataire': c.clientNom,
        Téléphone: c.clientTelephone,
        Ville: c.ville,
        Adresse: c.adresse,
        'Prix COD': Number(Number(c.montantCod).toFixed(2)),
        Produit: produit,
        Quantité: quantite,
        'Autorisé à Ouvrir': c.ouvrir ? 'Oui' : 'Non',
        'Colis à Remplacer': c.aRemplacer ? 'Oui' : 'Non',
        Commentaire: c.notes ?? '',
      };
    });

    const feuille = XLSX.utils.json_to_sheet(lignes);
    feuille['!cols'] = [14, 24, 14, 16, 36, 10, 32, 9, 16, 16, 30].map((wch) => ({ wch }));
    // Téléphone en texte : sinon Excel mange le 0 de tête (0612… → 612…).
    for (let i = 0; i < lignes.length; i++) {
      const cellule = feuille[XLSX.utils.encode_cell({ r: i + 1, c: 2 })];
      if (cellule) cellule.t = 's';
      const prix = feuille[XLSX.utils.encode_cell({ r: i + 1, c: 5 })];
      if (prix) prix.z = '0.00';
    }
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
