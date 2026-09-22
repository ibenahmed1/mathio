import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { demanderRelivraisonChezPower } from '@/lib/actions-power-delivery';

const RAISON_MAX = 150;
const ADRESSE_MAX = 300;
// Chiffres, espaces, « + », « - », « . » et parenthèses : ce qu'on trouve dans
// un numéro saisi à la main, rien qui puisse porter autre chose.
const TELEPHONE = /^[0-9+\-. ()]{6,20}$/;

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

// § Power Delivery — demande une nouvelle tentative de livraison
// (`request-redelivery`), éventuellement avec une nouvelle adresse ou un
// nouveau téléphone, mis à jour chez eux ET chez nous dans le même geste. Un
// colis annulé est rouvert (lib/actions-power-delivery.ts).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const raison = texte(body.raison);
    const nouvelleAdresse = texte(body.nouvelleAdresse);
    const nouveauTelephone = texte(body.nouveauTelephone);

    if (raison.length > RAISON_MAX) throw new ApiError(400, `raison est limitée à ${RAISON_MAX} caractères`);
    if (nouvelleAdresse.length > ADRESSE_MAX) {
      throw new ApiError(400, `nouvelleAdresse est limitée à ${ADRESSE_MAX} caractères`);
    }
    if (nouveauTelephone && !TELEPHONE.test(nouveauTelephone)) {
      throw new ApiError(400, 'nouveauTelephone n’est pas un numéro valide');
    }

    const resultat = await demanderRelivraisonChezPower(
      id,
      {
        raison: raison || null,
        nouvelleAdresse: nouvelleAdresse || null,
        nouveauTelephone: nouveauTelephone || null,
      },
      session.sub
    );
    return NextResponse.json({ success: true, ...resultat });
  } catch (error) {
    return jsonError(error);
  }
}
