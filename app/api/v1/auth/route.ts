import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';

// POST /api/v1/auth — « mes identifiants sont-ils bons ? »
//
// N'exige AUCUN scope, et c'est le point : un intégrateur qui débranche doit
// pouvoir distinguer « ma clé est mauvaise » (401) de « ma clé est bonne mais
// on ne m'a pas ouvert cet endpoint » (403). Un test qui exigerait un scope
// confondrait les deux, et renverrait l'intégrateur chercher la panne du
// mauvais côté.
//
// Sans lui, la seule façon de vérifier un branchement serait de poser un vrai
// statut sur un vrai colis — c'est-à-dire de faire une écriture d'argent pour
// répondre à une question de configuration.
//
// La réponse ne contient QUE ce que l'appelant possède déjà : son propre code
// de plateforme, son environnement, ses propres scopes. Rien qui renseigne
// sur notre système, et surtout rien qui distingue deux clés valides — c'est
// un test de branchement, pas un point d'exploration.
const CHEMIN = '/api/v1/auth';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;

  try {
    contexte = await requirePlateforme(request, []);

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'POST',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
    });

    return avecEntetesPlateforme(
      NextResponse.json({
        valide: true,
        plateforme: contexte.plateformeCode,
        environnement: contexte.environnement,
        scopes: contexte.scopes,
      }),
      contexte
    );
  } catch (error) {
    const reponse = jsonErreurPlateforme(error);
    // `contexte` est nul quand c'est l'identification elle-même qui a échoué :
    // il n'y a alors ni plateforme ni clé à rattacher, donc rien à journaliser.
    // C'est le comportement des autres routes /api/v1, et il est voulu — le
    // journal est indexé par plateforme, une ligne orpheline n'y serait
    // retrouvable par personne.
    if (contexte) {
      await journaliserAppel({
        plateformeId: contexte.plateformeId,
        cleId: contexte.cleId,
        methode: 'POST',
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
