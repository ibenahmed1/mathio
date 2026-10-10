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
import { analyserEntreeProduit, declarerProduit } from '@/lib/plateforme-produits';

// POST /v1/produits — déclaration d'un produit de stock (et de ses variantes)
// pour un marchand synchronisé (§ lib/plateforme-produits.ts).
//
//   201  le produit a été créé chez nous
//   200  ce SKU était déjà déclaré pour ce marchand : rien n'a été écrit
const CHEMIN = '/v1/produits';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    contexte = await requirePlateforme(request, ['produits:creation']);
    const entree = analyserEntreeProduit(await lireCorpsJson(request));
    reference = entree.reference;

    const resultat = await declarerProduit(contexte, entree);
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
