import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  analyserEntreeStatut,
  appliquerStatut,
  prestataireDeLaCle,
} from '@/lib/livraison-statut';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  lireCorpsJson,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';

// POST /api/v1/livraisons/statut — un transporteur sous-traitant déclare
// l'issue d'une livraison.
//
// C'est le seul endpoint qui fait avancer un colis depuis l'extérieur, et le
// seul de la surface machine à pouvoir en FERMER un. Toutes ses règles vivent
// dans lib/livraison-statut.ts ; ce handler valide l'entrée, appelle, et
// sérialise.
//
// Rejouer la même déclaration répond 200 avec `issue: "inchange"` plutôt qu'une
// erreur — même politique que POST /v1/colis : une reprise après timeout est
// un cas normal, et l'appelant a besoin de savoir où en est le colis, pas
// d'un refus.
const CHEMIN = '/api/v1/livraisons/statut';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    contexte = await requirePlateforme(request, ['livraisons:statut']);
    const prestataireId = await prestataireDeLaCle(contexte);

    const entree = analyserEntreeStatut(await lireCorpsJson(request));
    reference = entree.codeSuivi;

    const resultat = await appliquerStatut(contexte, prestataireId, entree);

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'POST',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
      reference,
    });

    return avecEntetesPlateforme(NextResponse.json(resultat), contexte);
  } catch (error) {
    const reponse = jsonErreurPlateforme(error);
    if (contexte) {
      await journaliserAppel({
        plateformeId: contexte.plateformeId,
        cleId: contexte.cleId,
        methode: 'POST',
        chemin: CHEMIN,
        statut: reponse.status,
        debutMs,
        adresseIp: contexte.adresseIp,
        reference,
        erreur: error instanceof ApiError ? error.message : 'Erreur interne',
      });
    }
    return reponse;
  }
}
