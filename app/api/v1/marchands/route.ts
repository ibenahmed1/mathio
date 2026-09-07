import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  avecEntetesPlateforme,
  exigeUnScopeParmi,
  journaliserAppel,
  jsonErreurPlateforme,
  lireCorpsJson,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';
import { analyserEntreeMarchand, synchroniserMarchand } from '@/lib/plateforme-marchands';

// POST /v1/marchands — synchronisation d'un compte marchand depuis une
// plateforme partenaire.
//
// N'est atteignable que depuis l'hôte de l'API machine : le proxy renvoie 404
// sur `/api/v1/**` pour les trois hôtes d'espace, et 404 sur tout le reste
// pour l'hôte de l'API (proxy.ts §1 bis).
//
// Deux codes de succès, et la distinction porte du sens pour l'appelant :
//   201  le marchand a été créé chez nous
//   200  rien n'a été créé — il existait déjà (rattaché), ou cet identifiant
//        externe nous était déjà connu (rejeu sans effet)
const CHEMIN = '/v1/marchands';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;
  let reference: string | null = null;

  try {
    // Aucun scope exigé ici : deux scopes distincts ouvrent cet endpoint, et
    // celui qui est détenu décide de l'issue (compte actif ou en attente).
    contexte = await requirePlateforme(request, []);
    const scope = exigeUnScopeParmi(contexte, ['marchands:creation_validee', 'marchands:creation']);

    const entree = analyserEntreeMarchand(await lireCorpsJson(request));
    reference = entree.idExterne;

    const resultat = await synchroniserMarchand(contexte, entree, {
      activer: scope === 'marchands:creation_validee',
    });

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
    // Un appel refusé AVANT l'authentification n'a pas de plateforme à qui
    // l'attribuer : il n'est donc pas journalisé ici. C'est assumé — une clé
    // inconnue ne désigne personne, et inventer un rattachement rendrait le
    // journal d'une plateforme pollué par le trafic d'une autre.
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
