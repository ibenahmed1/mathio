import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserDate, analyserMontant, analyserPreuveComptable, dataUrlPreuve, texteFacultatif } from '@/lib/finance';
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

// Corriger un versement saisi par erreur : montant, date, note, photo. Le
// journal comptable suit le montant et la date.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const m: ModificationVersement = {};
    if (body.montantRecu !== undefined) {
      const montant = analyserMontant(body.montantRecu);
      if (montant.statut === 'refus') throw new ApiError(400, montant.message);
      m.montantRecu = montant.valeur;
    }
    if (body.dateVersement !== undefined) {
      const date = analyserDate(body.dateVersement, 'Date du versement');
      if (date.statut === 'refus') throw new ApiError(400, date.message);
      m.dateVersement = date.valeur;
    }
    if (body.note !== undefined) m.note = texteFacultatif(body.note);
    if (body.preuve !== undefined) m.preuveUrl = lirePreuve(body.preuve);
    await modifierVersement(id, m);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
