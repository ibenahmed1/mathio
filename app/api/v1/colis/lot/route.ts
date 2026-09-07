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
import { ingererLot } from '@/lib/plateforme-colis';

// POST /v1/colis/lot — dépôt par lot.
//
// Réponse 207 (Multi-Status), et c'est le point important de cet endpoint : un
// lot est PARTIELLEMENT acceptable. 200 colis dont 3 portent une ville
// illisible en créent 197, et les 3 lignes refusées sont désignées par leur
// index et leur référence. Le code global ne dit donc rien du sort d'une ligne
// — seul `lignes[].ok` le dit.
//
// 207 même quand tout passe : un code de retour qui change selon le contenu
// obligerait l'appelant à écrire deux chemins de lecture, et c'est exactement
// le genre de subtilité qu'une intégration finit par ignorer.
const CHEMIN = '/v1/colis/lot';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;

  try {
    contexte = await requirePlateforme(request, ['colis:creation']);

    const resultat = await ingererLot(contexte, await lireCorpsJson(request));

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'POST',
      chemin: CHEMIN,
      statut: 207,
      debutMs,
      adresseIp: contexte.adresseIp,
      // `reference` est INDEXÉ et sert à chercher « où est passé le colis X » :
      // y écrire « lot de 50 » brouillerait exactement ce à quoi il sert. Le
      // volume du lot appartient au compte rendu, pas à la clé de recherche.
      reference: null,
      // Le compte des refus part dans le journal même quand l'appel réussit :
      // c'est le seul endroit où une dérive silencieuse (une plateforme dont
      // 30 % des lignes tombent) devient visible sans qu'on nous le signale.
      erreur:
        resultat.refuses > 0
          ? `${resultat.refuses} ligne(s) refusée(s) sur ${resultat.total}`
          : `lot de ${resultat.total}, aucun refus`,
    });

    return avecEntetesPlateforme(NextResponse.json(resultat, { status: 207 }), contexte);
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
        erreur: error instanceof ApiError ? error.message : 'Erreur interne',
      });
    }
    return reponse;
  }
}
