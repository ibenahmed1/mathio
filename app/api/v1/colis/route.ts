import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  lireCorpsJson,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';
import { analyserEntreeColis, chargerReferentielVilles, ingererColis } from '@/lib/plateforme-colis';
import { analyserRequeteSuivi, listerColisModifies } from '@/lib/plateforme-suivi';

// POST /v1/colis — dépôt d'un colis à l'unité.
//
// Rejouer la même `reference` répond 200 avec le code de suivi déjà attribué
// (et non une erreur) : une reprise après timeout est un cas normal, et
// l'appelant a besoin du code pour se réconcilier, pas d'un refus.
const CHEMIN = '/v1/colis';

// GET /v1/colis — les colis déposés par la plateforme dont le statut a
// changé, chacun avec son statut actuel (§ lib/plateforme-suivi.ts). Scope
// `colis:lecture`, distinct de `colis:creation` : lire et déposer sont deux
// droits.
export async function GET(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  try {
    contexte = await requirePlateforme(request, ['colis:lecture']);
    const requete = analyserRequeteSuivi(new URL(request.url).searchParams);
    const page = await listerColisModifies(contexte, requete);
    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'GET',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
    });
    return avecEntetesPlateforme(NextResponse.json(page), contexte);
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

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    contexte = await requirePlateforme(request, ['colis:creation']);

    const entree = analyserEntreeColis(await lireCorpsJson(request));
    reference = entree.reference;

    const villes = await chargerReferentielVilles();
    const resultat = await ingererColis(contexte, entree, villes);

    const statut = resultat.issue === 'cree' ? 201 : 200;
    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'POST',
      chemin: CHEMIN,
      statut,
      debutMs,
      adresseIp: contexte.adresseIp,
      reference,
    });

    return avecEntetesPlateforme(NextResponse.json(resultat, { status: statut }), contexte);
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
