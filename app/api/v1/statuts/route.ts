import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';
import { CATALOGUE_STATUTS_PRESTATAIRE } from '@/lib/statuts';

// GET /api/v1/statuts — le catalogue des statuts qu'une clé a le droit de
// poser (§ CATALOGUE_STATUTS_PRESTATAIRE, lib/statuts.ts).
//
// Servi par l'API plutôt que figé dans une page de documentation, parce que
// c'est le seul moyen pour un intégrateur de rester synchronisé sans relire
// la doc : le jour où une valeur s'ajoute, son système la connaît au premier
// appel suivant.
//
// Le scope requis est celui de l'ÉCRITURE, `livraisons:statut`, et non un
// scope de lecture dédié. Ce n'est pas un raccourci : ce catalogue est la
// liste de ce que CETTE clé peut poser, il n'a aucun sens pour une clé qui ne
// peut rien poser. Une clé de plateforme de vente reçoit donc 403, ce qui est
// la réponse juste — pas 200 avec une liste qu'elle ne pourrait jamais
// utiliser.
//
// Réponse enveloppée dans un objet plutôt que servie en tableau nu : y
// ajouter un champ plus tard reste compatible, alors que passer d'un tableau
// à un objet ne l'est jamais. La contrainte est la même que sur le catalogue
// lui-même — ce qui sort d'ici est un contrat public.
const CHEMIN = '/api/v1/statuts';

export async function GET(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;

  try {
    contexte = await requirePlateforme(request, ['livraisons:statut']);

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'GET',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
    });

    return avecEntetesPlateforme(
      NextResponse.json({ statuts: CATALOGUE_STATUTS_PRESTATAIRE }),
      contexte
    );
  } catch (error) {
    const reponse = jsonErreurPlateforme(error);
    if (contexte) {
      await journaliserAppel({
        plateformeId: contexte.plateformeId,
        cleId: contexte.cleId,
        methode: 'GET',
        chemin: CHEMIN,
        statut: reponse.status,
        debutMs,
        adresseIp: contexte.adresseIp,
        erreur: error instanceof ApiError ? error.message : 'Erreur interne',
      });
    }
    return reponse;
  }
}
