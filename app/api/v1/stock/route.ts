import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';
import { lireStock } from '@/lib/plateforme-stock';

// GET /v1/stock — le stock de l'univers de la plateforme : son stock commun
// et le stock personnel de ses marchands (§ lib/plateforme-stock.ts). Avec
// ?idExterneMarchand= : ce que possède ce marchand, et les produits communs
// qu'il a vendus avec sa consommation.
const CHEMIN = '/v1/stock';

export async function GET(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    contexte = await requirePlateforme(request, ['stock:lecture']);
    const idExterneMarchand = new URL(request.url).searchParams.get('idExterneMarchand')?.trim() || null;
    reference = idExterneMarchand;
    const reponse = { stock: await lireStock(contexte, idExterneMarchand) };
    const statut = 200;
    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'GET',
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
        methode: 'GET',
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
