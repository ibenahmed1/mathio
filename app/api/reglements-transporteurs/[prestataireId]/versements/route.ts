import { NextResponse } from 'next/server';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { analyserDate, analyserMontant, analyserPreuveComptable, dataUrlPreuve, texteFacultatif } from '@/lib/finance';
import { enregistrerVersement } from '@/lib/reglements-transporteurs';

// Photo du reçu bancaire : facultative, même règle que les justificatifs du
// journal (data URL d'image, liste blanche, poids maximal).
function lirePreuve(brut: unknown): string | null {
  if (brut === undefined || brut === null || brut === '') return null;
  if (typeof brut !== 'string') throw new ApiError(400, 'Photo du reçu illisible');
  const analyse = analyserPreuveComptable(brut);
  if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
  return dataUrlPreuve(analyse.preuve);
}

// « Marquer payé » : un versement reçu du transporteur, pour les colis cochés.
// Le montant reçu peut différer de l'attendu : l'écart est enregistré et
// affiché, sans autre traitement (question 26, SOUS_TRAITANCE.md).
export async function POST(request: Request, { params }: { params: Promise<{ prestataireId: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { prestataireId } = await params;
    const body = await request.json();

    const montant = analyserMontant(body.montantRecu);
    if (montant.statut === 'refus') throw new ApiError(400, montant.message);
    const date = analyserDate(body.dateVersement, 'Date du versement');
    if (date.statut === 'refus') throw new ApiError(400, date.message);

    const versement = await enregistrerVersement({
      prestataireId,
      creanceIds: parseStringIdArray(body.creanceIds),
      montantRecu: montant.valeur,
      dateVersement: date.valeur,
      preuveUrl: lirePreuve(body.preuve),
      note: texteFacultatif(body.note),
      auteurId: session.sub,
    });
    return NextResponse.json(versement, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
