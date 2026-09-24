import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { analyserEntreeStatut } from '../livraison-statut';
import {
  STATUTS_META,
  analyserEvenementMeta,
  signatureMetaValide,
  traduireEvenementMeta,
  type EvenementMeta,
} from '../meta-livraison-statuts';
import { STATUTS_PRESTATAIRE, statutPrestataire } from '../statuts';

// Relevé de `GET /partner/statuses` du 21/09/2026. Si ce test casse, leur
// catalogue et le nôtre ont divergé : c'est une décision à prendre, pas un
// test à réaligner.
const CATALOGUE_RELEVE = [
  'NOT_PAID', 'PAID', 'INVOICED', 'INCORRECT_ADDRESS', 'NEW_PARCEL', 'WAITING_PICKUP', 'PICKED_UP',
  'PICKED_UP_IN_AGENCY', 'VALID_FOR_PREPARING', 'SENT', 'RECEIVED', 'RECEIVED_IN_AGENCY', 'DISTRIBUTION',
  'IN_PROGRESS', 'IN_AGENCY', 'DELIVERED', 'RETURNED', 'PREPARED_FOR_RETOURNE', 'SENT_TO_AGENCY',
  'SENT_TO_VENDOR', 'RECEIVED_BY_AGENCY', 'RETURNED_TO_VENDOR', 'RETURNED_TO_STOCK', 'SENT_BY_AMANA',
  'PROGRAMMER_AUTO', 'POSTPONED', 'NOANSWER', 'UNREACHABLE', 'OUT_OF_AREA', 'CANCELED', 'REFUSE',
  'RETURN_BY_AMANA', 'CANCELED_BY_VENDEUR', 'ERR', 'CLIENT_INTERESSE', 'PROGRAMMER', 'DEUX', 'TROIS',
  'EN_VOYAGE', 'RELENCE_NEW_CLIENT', 'WAIT_RELANCE', 'BV', 'REPORTE_AUJOURDHUI', 'PROGRAMMER_TODAY',
  'OUT_FOR_DELIVERY',
];

function evenement(partiel: Partial<EvenementMeta>): EvenementMeta {
  return {
    id: 'evt-1',
    evenement: 'parcel.status.updated',
    survenuLe: '2026-09-21T10:00:00Z',
    code: 'MT-2026-00123',
    statut: 'DELIVERED',
    statutPrecedent: 'IN_PROGRESS',
    libelle: 'Livré',
    planifieLe: null,
    livreurNom: null,
    livreurTelephone: null,
    ...partiel,
  };
}

// ------------------------------------------------------------
// Catalogue
// ------------------------------------------------------------

test('chacun de leurs 45 statuts a un traitement décidé', () => {
  assert.equal(CATALOGUE_RELEVE.length, 45);
  for (const code of CATALOGUE_RELEVE) assert.ok(STATUTS_META[code], `statut sans traitement : ${code}`);
  assert.equal(Object.keys(STATUTS_META).length, CATALOGUE_RELEVE.length);
});

test('un statut appliqué appartient toujours à notre liste blanche', () => {
  for (const [code, regle] of Object.entries(STATUTS_META)) {
    if (regle.traitement !== 'applique') continue;
    assert.ok(STATUTS_PRESTATAIRE.includes(regle.statut), `${code} → ${regle.statut} hors liste blanche`);
  }
});

test('un statut qui exige une date chez nous en reçoit toujours une', () => {
  for (const [code, regle] of Object.entries(STATUTS_META)) {
    if (regle.traitement !== 'applique') continue;
    const attendu = statutPrestataire(regle.statut)!.dateRequise;
    assert.equal(Boolean(regle.date), attendu, code);
  }
});

test('NOANSWER ne devient jamais pas_de_reponse_sms', () => {
  const regle = STATUTS_META.NOANSWER;
  assert.equal(regle.traitement, 'applique');
  assert.equal(regle.traitement === 'applique' && regle.statut, 'injoignable');
});

test('EN_VOYAGE, faux ami, n’est pas appliqué', () => {
  assert.equal(STATUTS_META.EN_VOYAGE.traitement, 'journal');
});

// ------------------------------------------------------------
// Signature
// ------------------------------------------------------------

const SECRET = 'secret-de-test';
const CORPS = '{"id":"evt-1","data":{"code":"MT-1","status":"DELIVERED"}}';
const signer = (corps: string, encodage: 'hex' | 'base64' = 'hex') =>
  `sha256=${createHmac('sha256', SECRET).update(corps).digest(encodage)}`;

test('une signature hexadécimale correcte est acceptée', () => {
  assert.equal(signatureMetaValide(CORPS, signer(CORPS), SECRET), true);
});

test('une signature base64 correcte est acceptée', () => {
  assert.equal(signatureMetaValide(CORPS, signer(CORPS, 'base64'), SECRET), true);
});

test('un corps altéré après signature est refusé', () => {
  assert.equal(signatureMetaValide(CORPS.replace('DELIVERED', 'REFUSE'), signer(CORPS), SECRET), false);
});

test('une signature sans préfixe sha256= est refusée', () => {
  const nue = signer(CORPS).replace('sha256=', '');
  assert.equal(signatureMetaValide(CORPS, nue, SECRET), false);
});

test('sans secret configuré, rien n’est accepté', () => {
  assert.equal(signatureMetaValide(CORPS, signer(CORPS), ''), false);
});

test('sans en-tête, rien n’est accepté', () => {
  assert.equal(signatureMetaValide(CORPS, null, SECRET), false);
});

// ------------------------------------------------------------
// Lecture de l'événement
// ------------------------------------------------------------

test('l’exemple de leur documentation se lit', () => {
  const evt = analyserEvenementMeta({
    id: 'u-1',
    event: 'parcel.status.updated',
    occurredAt: '2026-08-27T12:00:00Z',
    data: {
      code: 'cmd-001',
      previousStatus: 'IN_PROGRESS',
      status: 'PROGRAMMER',
      statusLabel: 'Programmé',
      scheduledAt: '2026-08-28T09:00:00Z',
      unreachableCount: 0,
      delivererName: 'Ahmed Benali',
      delivererPhone: '0612345678',
    },
  });
  assert.ok(evt);
  assert.equal(evt.code, 'CMD-001');
  assert.equal(evt.statut, 'PROGRAMMER');
  assert.equal(evt.planifieLe, '2026-08-28T09:00:00Z');
});

test('un corps sans code ou sans statut est illisible', () => {
  assert.equal(analyserEvenementMeta({ data: { status: 'DELIVERED' } }), null);
  assert.equal(analyserEvenementMeta({ data: { code: 'X' } }), null);
  assert.equal(analyserEvenementMeta([]), null);
  assert.equal(analyserEvenementMeta(null), null);
});

// ------------------------------------------------------------
// Traduction
// ------------------------------------------------------------

test('DELIVERED devient livre, accepté tel quel par notre API', () => {
  const t = traduireEvenementMeta(evenement({ statut: 'DELIVERED' }));
  assert.equal(t.issue, 'applique');
  if (t.issue !== 'applique') return;
  const entree = analyserEntreeStatut(t.corps);
  assert.equal(entree.statut.statut, 'livre');
  assert.equal(entree.codeSuivi, 'MT-2026-00123');
});

test('POSTPONED porte leur scheduledAt comme date de nouvelle tentative', () => {
  const t = traduireEvenementMeta(evenement({ statut: 'POSTPONED', planifieLe: '2026-09-23T09:00:00Z' }));
  assert.equal(t.issue, 'applique');
  if (t.issue !== 'applique') return;
  const entree = analyserEntreeStatut(t.corps);
  assert.equal(entree.statut.statut, 'reporte');
  assert.equal(entree.date?.toISOString(), '2026-09-23T09:00:00.000Z');
});

test('POSTPONED sans scheduledAt est journalisé, pas inventé', () => {
  assert.equal(traduireEvenementMeta(evenement({ statut: 'POSTPONED' })).issue, 'journal');
});

test('REPORTE_AUJOURDHUI prend la date de l’événement', () => {
  const t = traduireEvenementMeta(evenement({ statut: 'REPORTE_AUJOURDHUI' }));
  assert.equal(t.issue, 'applique');
  if (t.issue !== 'applique') return;
  assert.equal(analyserEntreeStatut(t.corps).date?.toISOString(), '2026-09-21T10:00:00.000Z');
});

test('leur circuit interne et leurs paiements sont journalisés', () => {
  for (const statut of ['IN_PROGRESS', 'RECEIVED_IN_AGENCY', 'PAID', 'RETURNED']) {
    assert.equal(traduireEvenementMeta(evenement({ statut })).issue, 'journal', statut);
  }
});

test('un statut inconnu de leur catalogue est journalisé, jamais en erreur', () => {
  assert.equal(traduireEvenementMeta(evenement({ statut: 'NOUVEAU_CODE' })).issue, 'journal');
});

test('un autre type d’événement est journalisé', () => {
  assert.equal(traduireEvenementMeta(evenement({ evenement: 'parcel.created' })).issue, 'journal');
});

test('la note cite le livreur quand ils l’envoient', () => {
  const t = traduireEvenementMeta(evenement({ livreurNom: 'Ahmed Benali', livreurTelephone: '0612345678' }));
  assert.equal(t.issue, 'applique');
  if (t.issue !== 'applique') return;
  assert.equal(t.corps.note, 'Meta : Livré · livreur Ahmed Benali 0612345678');
});

test('une note trop longue est tronquée à la limite de l’historique', () => {
  const t = traduireEvenementMeta(evenement({ libelle: 'x'.repeat(200) }));
  assert.equal(t.issue, 'applique');
  if (t.issue !== 'applique') return;
  assert.ok(t.corps.note.length <= 150);
  assert.doesNotThrow(() => analyserEntreeStatut(t.corps));
});
