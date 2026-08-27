import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { previsualiserFacture } from '@/lib/facturation';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// § /admin/factures/nouvelle, étape 2 : ce que contiendrait la facture si on
// la créait maintenant. Ne mute rien. Les montants viennent du MÊME calcul que
// la création (calculerFacture) pour qu'aucun écart ne puisse apparaître entre
// ce que l'admin a vu et ce qu'il a signé.
//
// La liste des marchands ayant de la matière vit dans GET /api/factures/marchands
// — elle répondait ici à un POST, verbe faux pour une lecture et impossible à
// mettre en cache.
export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_FACTURATION]);
    const { searchParams } = request.nextUrl;
    const marchandId = searchParams.get('marchandId');
    if (!marchandId) throw new ApiError(400, 'marchandId est requis');

    // `factureId` : reprise d'un brouillon — l'assiette doit alors inclure les
    // colis que cette facture retient déjà, sinon l'écran s'ouvrirait sur une
    // sélection dont la moitié des lignes auraient disparu du vivier.
    return NextResponse.json(
      await previsualiserFacture(marchandId, searchParams.get('factureId') ?? undefined)
    );
  } catch (error) {
    return jsonError(error);
  }
}
