import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { listerVillesReferentiel } from '@/lib/villes-referentiel';

// § Saisie des villes : la liste des villes livrables, pour les listes
// déroulantes des trois espaces (admin, marchand, terrain). Tout compte
// connecté peut la lire — elle ne porte que des noms.
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(
      { data: await listerVillesReferentiel() },
      // Change rarement (ajout d'une ville à un hub) : cinq minutes de cache
      // navigateur évitent de la recharger à chaque formulaire ouvert.
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (error) {
    return jsonError(error);
  }
}
