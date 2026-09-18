import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-utils';
import {
  analyserLotStatuts,
  appliquerLotStatuts,
  perimetreDuTransporteur,
} from '@/lib/livraison-statut';
import {
  avecEntetesPlateforme,
  journaliserAppel,
  jsonErreurPlateforme,
  lireCorpsJson,
  requirePlateforme,
  type ContextePlateforme,
} from '@/lib/plateforme-auth';

// POST /api/v1/livraisons/statut/lot — la version en lot du endpoint ci-dessus,
// appelée en fin de tournée ou la nuit.
//
// Elle existe parce qu'un livreur qui rentre a trente colis à déclarer : sans
// lot, c'est trente requêtes, et le premier échec le laisse à mi-chemin sans
// savoir lesquelles sont passées.
//
// Réponse TOUJOURS 200, même si tout est refusé — le lot a bien été traité,
// c'est son contenu qui porte le détail ligne par ligne. Un 4xx global
// dirait « je n'ai rien fait », ce qui serait faux dès qu'une seule ligne
// est passée. Seules les erreurs qui empêchent de traiter le lot lui-même
// (clé, scope, corps illisible, plafond dépassé) sortent en erreur HTTP.
//
// Chemin en `/lot` plutôt qu'un endpoint frère nommé au pluriel : c'est la
// convention déjà posée par POST /v1/colis et POST /v1/colis/lot, et deux
// routes qui ne différeraient que par un « s » final se confondraient à la
// lecture d'un journal.
const CHEMIN = '/api/v1/livraisons/statut/lot';

export async function POST(request: Request) {
  const debutMs = performance.now();
  let contexte: ContextePlateforme | null = null;

  try {
    contexte = await requirePlateforme(request, ['livraisons:statut']);
    const perimetre = await perimetreDuTransporteur(contexte);

    const lignes = analyserLotStatuts(await lireCorpsJson(request));
    const resultat = await appliquerLotStatuts(contexte, perimetre, lignes);

    await journaliserAppel({
      plateformeId: contexte.plateformeId,
      cleId: contexte.cleId,
      methode: 'POST',
      chemin: CHEMIN,
      statut: 200,
      debutMs,
      adresseIp: contexte.adresseIp,
      // Le lot ne vise pas un colis : on journalise sa taille et son taux de
      // refus, qui sont ce qu'on relit quand un partenaire dit « mes statuts
      // ne passent pas ».
      reference: `${resultat.totalTraite}/${resultat.totalTraite + resultat.totalRefuse}`,
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
        erreur: error instanceof ApiError ? error.message : 'Erreur interne',
      });
    }
    return reponse;
  }
}
