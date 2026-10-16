import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';

// Excel transmis au transporteur. Colonnes et ordre fixés par l'exploitation
// le 14/10/2026 — c'est le format attendu par les transporteurs, n'en ajouter
// aucune sans leur accord. Servi par l'export d'un bon d'envoi et par celui
// d'une sélection du BE exceptionnel.

export const includeColisExcel = {
  produit: { select: { nom: true } },
  lignes: { select: { libelle: true, quantite: true }, orderBy: { position: 'asc' } },
} as const;

export async function chargerColisExcel(ids: string[]) {
  return prisma.commande.findMany({ where: { id: { in: ids } }, include: includeColisExcel, orderBy: { codeSuivi: 'asc' } });
}

type ColisExcel = Awaited<ReturnType<typeof chargerColisExcel>>[number];

export function classeurColis(commandes: ColisExcel[]): Buffer {
  const lignes = commandes.map((c) => {
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
  return XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function reponseExcel(buffer: Buffer, nomFichier: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nomFichier}"`,
    },
  });
}
