import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NOTE_MAX,
  TAILLE_MAX_LOT_STATUTS,
  analyserEntreeStatut,
  analyserLotStatuts,
  deciderTransition,
} from '../livraison-statut';
import { ErreurPlateforme } from '../plateforme-auth';
import { statutPrestataire } from '../statuts';

// Seules la VALIDATION et la décision de transition sont testées ici :
// l'application écrit en base (colis, historique, commentaire) et relève d'un
// scénario de bout en bout, comme pour l'ingestion des colis partenaires.

const LIVRE = statutPrestataire('livre')!;
const REPORTE = statutPrestataire('reporte')!;

function refus(fn: () => unknown): ErreurPlateforme {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ErreurPlateforme, 'erreur non typée');
    return error;
  }
  throw new Error('aucune erreur levée');
}

// ------------------------------------------------------------
// Validation d'une déclaration
// ------------------------------------------------------------

test('une déclaration minimale est acceptée', () => {
  const entree = analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'livre' });

  assert.equal(entree.codeSuivi, 'PD-000123');
  assert.equal(entree.statut.statut, 'livre');
  assert.equal(entree.date, null);
  assert.equal(entree.note, null);
});

test('le code de suivi est normalisé en majuscules et détouré', () => {
  // Un partenaire qui recopie depuis un tableur ou un scan renvoie parfois une
  // autre casse : répondre 404 là-dessus enverrait chercher un colis qui existe.
  const entree = analyserEntreeStatut({ codeSuivi: '  pd-000123 ', statut: 'livre' });
  assert.equal(entree.codeSuivi, 'PD-000123');
});

test('un code de suivi absent, vide ou mal typé est refusé', () => {
  for (const codeSuivi of [undefined, '', '   ', null, 42, {}]) {
    const erreur = refus(() => analyserEntreeStatut({ codeSuivi, statut: 'livre' }));
    assert.equal(erreur.status, 400);
    assert.equal(erreur.code, 'champ_requis');
  }
});

test('un statut hors catalogue est refusé, et la réponse cite les valeurs acceptées', () => {
  const erreur = refus(() => analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'DELIVERED' }));

  assert.equal(erreur.status, 400);
  assert.equal(erreur.code, 'statut_invalide');
  assert.ok(erreur.message.includes('livre'), 'les valeurs acceptées ne sont pas citées');
});

test('un statut de NOTRE logistique est refusé comme un statut inconnu', () => {
  // `recu_au_hub` existe dans l'enum : il est refusé ici parce qu'il
  // n'appartient pas au catalogue prestataire, et c'est cette distinction que
  // le test protège — pas la simple validité de la valeur.
  const erreur = refus(() =>
    analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'recu_au_hub' })
  );
  assert.equal(erreur.code, 'statut_invalide');
});

// ------------------------------------------------------------
// La date, exigée par le statut et pas par le champ
// ------------------------------------------------------------

test('un report sans date est refusé', () => {
  const erreur = refus(() => analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'reporte' }));

  assert.equal(erreur.status, 400);
  assert.equal(erreur.code, 'date_requise');
});

test('un report avec une date illisible est refusé', () => {
  for (const date of ['demain', '', 42, null, '2026-13-45', '20260912']) {
    const erreur = refus(() =>
      analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'reporte', date })
    );
    assert.equal(erreur.code, 'date_requise', `accepté à tort : ${String(date)}`);
  }
});

test('une date au format ambigu est refusée, jamais devinée', () => {
  // `new Date('12/09/2026')` vaut le 9 DÉCEMBRE pour un partenaire qui écrivait
  // le 12 septembre. La date part dans la file de relance : l'erreur ne se
  // verrait qu'au moment où le colis ne serait pas retenté. Seul l'ISO passe.
  for (const date of ['12/09/2026', '12-09-2026', '09/12/2026']) {
    const erreur = refus(() =>
      analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'reporte', date })
    );
    assert.equal(erreur.code, 'date_requise', `interprété à tort : ${date}`);
  }
});

test('un horodatage ISO complet est accepté au même titre qu’une date seule', () => {
  const entree = analyserEntreeStatut({
    codeSuivi: 'PD-000123',
    statut: 'programme',
    date: '2026-09-12T14:30:00Z',
  });

  assert.ok(entree.date);
  assert.equal(entree.date.toISOString(), '2026-09-12T14:30:00.000Z');
});

test('un report daté est accepté et la date est conservée', () => {
  const entree = analyserEntreeStatut({
    codeSuivi: 'PD-000123',
    statut: 'reporte',
    date: '2026-09-12',
  });

  assert.ok(entree.date);
  assert.equal(entree.date.toISOString().slice(0, 10), '2026-09-12');
});

test('une date envoyée sur un statut qui n’en demande pas est ignorée, pas refusée', () => {
  // Les intégrateurs sérialisent souvent une structure unique où le champ est
  // toujours présent. Refuser les obligerait à découper leur code par statut
  // sans qu'aucun colis n'en soit mieux traité.
  const entree = analyserEntreeStatut({
    codeSuivi: 'PD-000123',
    statut: 'livre',
    date: '2026-09-12',
  });

  assert.equal(entree.date, null);
});

// ------------------------------------------------------------
// La note
// ------------------------------------------------------------

test('une note trop longue est refusée', () => {
  const erreur = refus(() =>
    analyserEntreeStatut({
      codeSuivi: 'PD-000123',
      statut: 'livre',
      note: 'x'.repeat(NOTE_MAX + 1),
    })
  );

  assert.equal(erreur.status, 400);
  assert.equal(erreur.code, 'note_trop_longue');
});

test('une note à la limite passe, une note vide vaut null', () => {
  const limite = analyserEntreeStatut({
    codeSuivi: 'PD-000123',
    statut: 'livre',
    note: 'x'.repeat(NOTE_MAX),
  });
  assert.equal(limite.note?.length, NOTE_MAX);

  const vide = analyserEntreeStatut({ codeSuivi: 'PD-000123', statut: 'livre', note: '   ' });
  assert.equal(vide.note, null);
});

// ------------------------------------------------------------
// Le lot
// ------------------------------------------------------------

test('un lot bien formé rend ses lignes', () => {
  const lignes = analyserLotStatuts({
    livraisons: [{ codeSuivi: 'PD-000123', statut: 'livre' }],
  });
  assert.equal(lignes.length, 1);
});

test('un lot vide, absent ou mal typé est refusé', () => {
  for (const corps of [{}, { livraisons: [] }, { livraisons: 'PD-000123' }, { livraisons: null }]) {
    const erreur = refus(() => analyserLotStatuts(corps));
    assert.equal(erreur.status, 400);
  }
});

test('un lot au-delà du plafond est refusé avant tout traitement', () => {
  const trop = Array.from({ length: TAILLE_MAX_LOT_STATUTS + 1 }, () => ({
    codeSuivi: 'PD-000123',
    statut: 'livre',
  }));

  const erreur = refus(() => analyserLotStatuts({ livraisons: trop }));
  assert.equal(erreur.code, 'lot_trop_grand');
});

// ------------------------------------------------------------
// Transition — les deux règles que les API du marché n'ont pas
// ------------------------------------------------------------

test('une transition ordinaire est autorisée', () => {
  assert.deepEqual(deciderTransition('mise_en_distribution', LIVRE), { issue: 'applique' });
});

test('rejouer le même statut est neutre, jamais une erreur', () => {
  // Une reprise après timeout est un cas NORMAL : renvoyer une erreur ferait
  // croire à un échec, et empiler une seconde ligne d'historique ferait croire
  // à une seconde tentative de livraison.
  assert.deepEqual(deciderTransition('reporte', REPORTE), { issue: 'inchange' });
});

test('un colis clos ne peut plus changer de statut', () => {
  const decision = deciderTransition('livre', REPORTE);

  assert.equal(decision.issue, 'refuse');
  assert.ok(decision.issue === 'refuse' && decision.code === 'colis_clos');
});

test('rejouer le statut d’un colis clos reste neutre', () => {
  // L'ordre des deux règles compte : l'idempotence passe AVANT la clôture,
  // sinon un lot rejoué après une livraison ferait remonter des 409 sur des
  // colis parfaitement traités, et le partenaire chercherait une panne
  // inexistante.
  assert.deepEqual(deciderTransition('livre', LIVRE), { issue: 'inchange' });
});
