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
import { analyserEntreeEnvoi, declarerEnvoi } from '@/lib/plateforme-stock';

// POST /v1/stock/envois — annonce d'un envoi de marchandise vers notre
// entrepôt (le réassort), pour des SKU déjà déclarés (§ lib/plateforme-stock.ts).
// Même droit que la déclaration des produits (`produits:creation`).
//
//   201  envoi enregistré, quantités annoncées
//   200  ce numéro d'envoi était déjà connu : rien n'a été compté deux fois
const CHEMIN = '/v1/stock/envois';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    contexte = await requirePlateforme(request, ['produits:creation']);
    const entree = analyserEntreeEnvoi(await lireCorpsJson(request));
    reference = entree.referenceEnvoi;
    const reponse = await declarerEnvoi(contexte, entree);
    const statut = reponse.issue === 'cree' ? 201 : 200;
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
    return avecEntetesPlateforme(NextResponse.json(reponse, { status: statut }), contexte);
  } catch (error) {
    const echec = jsonErreurPlateforme(error);
    if (contexte) {
      await journaliserAppel({
        plateformeId: contexte.plateformeId,
        cleId: contexte.cleId,
        methode: 'POST',
        chemin: CHEMIN,
        statut: echec.status,
        debutMs,
        adresseIp: contexte.adresseIp,
        reference,
        erreur: error instanceof ApiError ? error.message : 'Erreur interne',
      });
    }
    return echec;
  }
}
