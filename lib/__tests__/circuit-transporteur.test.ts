import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusTransporteur, type TransporteurPrevu } from '../hub-envoi';
import { colisResteALivrer } from '../statuts';
import { villeDesservie } from '../livraison-statut';
import { normaliserVille } from '../hub-stock';

// § Mise en production du 11/10/2026 : un colis n'entre que dans le bon du
// transporteur qui dessert sa ville. Ces tests fixent le verdict, pas l'écran.

const EST = { id: 'est', nom: 'EST Livraison' };
const META = { id: 'meta', nom: 'Meta Livraison' };
const prevuEst: TransporteurPrevu = {
  hubId: 'h-oujda',
  hubNom: 'Hub Oujda',
  prestataireId: EST.id,
  prestataireNom: EST.nom,
  villeNom: 'Nador Ville',
};
const colis = { codeSuivi: 'PD-000001', ville: 'Nador' };

test('un colis part chez son transporteur : aucun refus', () => {
  assert.equal(refusTransporteur(colis, prevuEst, EST), null);
});

test('un colis présenté à un autre transporteur est refusé, en nommant le bon', () => {
  const refus = refusTransporteur(colis, prevuEst, META);
  assert.ok(refus);
  assert.match(refus, /EST Livraison/);
  assert.match(refus, /Meta Livraison/);
});

test('une ville desservie par personne est refusée partout', () => {
  assert.match(refusTransporteur(colis, null, EST) ?? '', /aucun transporteur/);
  // Hub interne (sans transporteur) : ne peut pas non plus partir en sous-traitance.
  assert.ok(refusTransporteur(colis, { ...prevuEst, prestataireId: null, prestataireNom: null }, EST));
});

test('une graphie équivalente est reconnue par le périmètre du transporteur', () => {
  // La grille EST écrit « Nador Ville » ; le marchand saisit « Nador ».
  const villesEst = new Set([normaliserVille('Nador Ville'), 'nador ville']);
  assert.ok(villeDesservie(villesEst, 'Nador'));
  assert.ok(villeDesservie(villesEst, 'NADOR'));
});

test('reste à livrer : tournée = en distribution seulement', () => {
  const tournee = { bonDistribution: { id: 'bd' } };
  assert.ok(colisResteALivrer({ ...tournee, statut: 'mise_en_distribution' }));
  assert.ok(!colisResteALivrer({ ...tournee, statut: 'reporte' }));
});

test('reste à livrer : colis confié = non clos et pas parti en retour', () => {
  assert.ok(colisResteALivrer({ statut: 'en_transit', bonDistribution: null }));
  assert.ok(colisResteALivrer({ statut: 'reporte', bonDistribution: null }));
  assert.ok(colisResteALivrer({ statut: 'recu_au_hub', bonDistribution: null }));
  assert.ok(!colisResteALivrer({ statut: 'livre', bonDistribution: null }));
  assert.ok(!colisResteALivrer({ statut: 'refuse', bonDistribution: null }));
});
