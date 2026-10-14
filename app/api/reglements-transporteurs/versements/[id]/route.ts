import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserPreuveComptable, dataUrlPreuve, texteFacultatif } from '@/lib/finance';
import { modifierVersement, type ModificationVersement } from '@/lib/reglements-transporteurs';

// Photo du reçu bancaire : facultative, même règle que les justificatifs du
// journal (data URL d'image, liste blanche, poids maximal).
function lirePreuve(brut: unknown): string | null {
  if (brut === undefined || brut === null || brut === '') return null;
  if (typeof brut !== 'string') throw new ApiError(400, 'Photo du reçu illisible');
  const analyse = analyserPreuveComptable(brut);
  if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
  return dataUrlPreuve(analyse.preuve);
}

// Compléter un versement : note et photo du reçu. Montant et date sont figés
// à l'enregistrement (cf. modifierVersement) — on annule et on ressaisit.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    if (body.montantRecu !== undefined || body.dateVersement !== undefined) {
      throw new ApiError(409, 'Le montant et la date d’un versement ne se modifient plus : annulez-le puis saisissez-le à nouveau');
    }
    const m: ModificationVersement = {};
    if (body.note !== undefined) m.note = texteFacultatif(body.note);
    if (body.preuve !== undefined) m.preuveUrl = lirePreuve(body.preuve);
    await modifierVersement(id, m);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
