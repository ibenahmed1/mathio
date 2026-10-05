import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';
import { catalogueVilles } from '@/lib/plateforme-villes';

// GET /api/v1/villes — nos villes desservies : nom, code et tarif de livraison
// du transporteur (§ lib/plateforme-villes.ts).
//
// Scope `villes:lecture`, à part de `colis:creation` : lire nos tarifs et
// déposer des colis sont deux droits distincts, qu'on peut accorder
// séparément à une clé.
//
// Réponse enveloppée dans un objet, comme GET /v1/statuts : y ajouter un champ
// plus tard reste compatible.
const CHEMIN = '/api/v1/villes';

export async function GET(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;

  try {
    contexte = await requirePlateforme(request, ['villes:lecture']);
    const villes = await catalogueVilles();

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'GET',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
    });

    return avecEntetesPlateforme(NextResponse.json({ devise: 'MAD', nombre: villes.length, villes }), contexte);
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
