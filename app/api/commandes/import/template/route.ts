import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Modèles Excel téléchargeables pour l'import en masse (§ /admin/colis/import) :
// mêmes en-têtes attendues par la route de commit ci-dessous, avec une ligne
// d'exemple pour guider la saisie. `Produit` (colis normal) et `Ref` (colis
// stock) sont mutuellement exclusifs — d'où deux modèles distincts plutôt
// qu'un seul fichier avec des colonnes optionnelles.
const ENTETES_COMMUNES = [
  'Identifiant Marchand',
  'Code Suivi',
  'Nom du Destinataire',
  'Téléphone',
  'Ville',
  'Adresse',
  'Prix COD',
];

const EXEMPLE_COMMUN = [
  'marchand@exemple.com',
  'PART-0001',
  'Karim El Amrani',
  '0612345678',
  'Casablanca',
  '12 Rue des Fleurs, Maârif',
  '199.90',
];

const SUFFIXE_COMMUN = ['Quantité', 'Autorisé à Ouvrir', 'Colis à Remplacer', 'Commentaire'];
const EXEMPLE_SUFFIXE = ['1', 'Non', 'Non', ''];

export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin', 'superviseur', 'responsable']);

    const type = request.nextUrl.searchParams.get('type');
    if (type !== 'normal' && type !== 'stock') {
      throw new ApiError(400, "type invalide : attendu 'normal' ou 'stock'");
    }

    const colonneProduit = type === 'normal' ? 'Produit' : 'Ref';
    const exempleProduit = type === 'normal' ? 'T-shirt col rond noir M' : 'SKU-NOIR-M';

    const entetes = [...ENTETES_COMMUNES, colonneProduit, ...SUFFIXE_COMMUN];
    const exemple = [...EXEMPLE_COMMUN, exempleProduit, ...EXEMPLE_SUFFIXE];

    const feuille = XLSX.utils.aoa_to_sheet([entetes, exemple]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, type === 'normal' ? 'Colis normal' : 'Colis stock');
    const buffer = XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const nomFichier = type === 'normal' ? 'modele-colis-normal.xlsx' : 'modele-colis-stock.xlsx';

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
