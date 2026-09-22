import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  champsModifies,
  etatPreuveApres,
  idsARestaurer,
  idsASupprimer,
  refusModificationCompensation,
  type EtatCouple,
} from '../journal-comptable';
import { analyserModificationCommandeStockHub } from '../commandes-stock-hub';

// Les règles de ce module décident de ce qui sort du journal et de ce qui y
// revient. Une erreur n'y lève rien : elle laisse une compensation seule dans
// les totaux, ou une écriture annulée compter deux fois. D'où des tests sur
// chaque place qu'une écriture peut occuper dans un couple annulation /
// compensation.

// ------------------------------------------------------------
// Historique : ne tracer que ce qui change
// ------------------------------------------------------------

test('seuls les champs modifiés entrent dans l’historique', () => {
  const diff = champsModifies(
    { titre: 'Loyer', montant: 100, description: null },
    { titre: 'Loyer hub', montant: 100, description: null }
  );
  assert.deepEqual(diff, { avant: { titre: 'Loyer' }, apres: { titre: 'Loyer hub' } });
});

// Un PATCH qui renvoie les mêmes valeurs ne doit laisser aucune trace.
test('rien de changé, rien de tracé', () => {
  assert.equal(champsModifies({ montant: 100, type: 'revenu' }, { montant: 100, type: 'revenu' }), null);
});

// `undefined` et `null` disent la même chose : pas de valeur.
test('une valeur absente équivaut à null', () => {
  assert.equal(champsModifies({ description: null }, {}), null);
});

// Une photo remplacée par une autre resterait « joint → joint », invisible.
test('un justificatif remplacé est visible dans l’historique', () => {
  assert.equal(etatPreuveApres(true, undefined), 'joint');
  assert.equal(etatPreuveApres(false, undefined), 'aucun');
  assert.equal(etatPreuveApres(true, null), 'aucun');
  assert.equal(etatPreuveApres(false, 'data:image/png;base64,AA=='), 'joint');
  assert.equal(etatPreuveApres(true, 'data:image/png;base64,AA=='), 'remplacé');
});

// ------------------------------------------------------------
// Compensation : elle suit son origine
// ------------------------------------------------------------

test('le montant ou le sens d’une compensation ne se modifie pas seul', () => {
  const actuel = { montant: 100, type: 'depense' as const };
  assert.ok(refusModificationCompensation(true, actuel, { montant: 90 }));
  assert.ok(refusModificationCompensation(true, actuel, { type: 'revenu' }));
});

// Son titre, sa description, sa date restent modifiables ; et renvoyer les
// valeurs actuelles n'est pas une modification.
test('une compensation garde ses autres champs modifiables', () => {
  const actuel = { montant: 100, type: 'depense' as const };
  assert.equal(refusModificationCompensation(true, actuel, {}), null);
  assert.equal(refusModificationCompensation(true, actuel, { montant: 100, type: 'depense' }), null);
  assert.equal(refusModificationCompensation(false, actuel, { montant: 5 }), null);
});

// ------------------------------------------------------------
// Suppression / restauration d'un couple annulé
// ------------------------------------------------------------

const T0 = new Date('2026-09-21T10:00:00Z');
const T1 = new Date('2026-09-21T11:00:00Z');

function etat(partiel: Partial<EtatCouple>): EtatCouple {
  return { id: 'e', supprimeLe: null, origine: null, compensation: null, ...partiel };
}

test('une écriture ordinaire se supprime seule', () => {
  assert.deepEqual(idsASupprimer(etat({})), ['e']);
});

// Laissée seule, la compensation ferait apparaître dans les totaux un
// mouvement inverse d'une écriture qui n'y est plus.
test('supprimer une écriture annulée emporte sa compensation', () => {
  assert.deepEqual(idsASupprimer(etat({ compensation: { id: 'c', supprimeLe: null } })), ['e', 'c']);
});

test('une compensation déjà supprimée n’est pas supprimée deux fois', () => {
  assert.deepEqual(idsASupprimer(etat({ compensation: { id: 'c', supprimeLe: T0 } })), ['e']);
});

// Supprimer la compensation seule, c'est défaire l'annulation : l'origine reste.
test('supprimer une compensation n’emporte pas son origine', () => {
  assert.deepEqual(idsASupprimer(etat({ id: 'c', origine: { id: 'e', supprimeLe: null } })), ['c']);
});

test('restaurer une pièce non supprimée est refusé', () => {
  assert.equal(idsARestaurer(etat({})).statut, 'refus');
});

test('restaurer une écriture ramène la compensation supprimée avec elle', () => {
  const r = idsARestaurer(etat({ supprimeLe: T0, compensation: { id: 'c', supprimeLe: T0 } }));
  assert.deepEqual(r, { statut: 'ok', ids: ['e', 'c'] });
});

// Supprimée à part, AVANT : elle avait été retirée pour elle-même.
test('une compensation supprimée à un autre moment reste supprimée', () => {
  const r = idsARestaurer(etat({ supprimeLe: T1, compensation: { id: 'c', supprimeLe: T0 } }));
  assert.deepEqual(r, { statut: 'ok', ids: ['e'] });
});

// Elle neutraliserait une écriture absente du journal.
test('une compensation ne se restaure pas sans son origine', () => {
  const r = idsARestaurer(etat({ id: 'c', supprimeLe: T0, origine: { id: 'e', supprimeLe: T0 } }));
  assert.equal(r.statut, 'refus');
});

test('une compensation se restaure si son origine est dans le journal', () => {
  const r = idsARestaurer(etat({ id: 'c', supprimeLe: T0, origine: { id: 'e', supprimeLe: null } }));
  assert.deepEqual(r, { statut: 'ok', ids: ['c'] });
});

// ------------------------------------------------------------
// Commande d'inventaire (PATCH)
// ------------------------------------------------------------

// Le statut a sa route et sa permission : le glisser dans une modification
// contournerait le cycle brouillon → commandée → reçue.
test('le statut d’une commande ne passe pas par la modification', () => {
  assert.equal(analyserModificationCommandeStockHub({ statut: 'recue' }).statut, 'refus');
});

test('la catégorie d’une commande peut être retirée', () => {
  const r = analyserModificationCommandeStockHub({ categorieId: null, sousTitre: '' });
  assert.equal(r.statut, 'ok');
  if (r.statut === 'ok') assert.deepEqual(r.valeur, { categorieId: null, sousTitre: null });
});

test('le mode de paiement d’une commande ne peut pas être vidé', () => {
  assert.equal(analyserModificationCommandeStockHub({ modePaiement: '  ' }).statut, 'refus');
});
