import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codeDansListe,
  codeExterneDeReponse,
  construireColisColivraison,
  creationReussie,
  lignesDeListe,
  lireSuiviColivraison,
  messageColivraison,
  type ColisAConfier,
} from '../colivraison';
import { sortStatutColivraison } from '../colivraison-statuts';

const colis = (surcharge: Partial<ColisAConfier> = {}): ColisAConfier => ({
  codeSuivi: 'PD-000123',
  clientNom: '  Amina Alaoui ',
  clientTelephone: ' 0612345678 ',
  adresse: ' 12 rue des Oliviers ',
  montantCod: '249.999',
  ouvrir: true,
  fragile: false,
  aRemplacer: false,
  produitDescription: 'Robe, ceinture',
  quantite: 2,
  ...surcharge,
});

// ------------------------------------------------------------
// Construction
// ------------------------------------------------------------

test('le colis transmis porte le destinataire, la ville de LEUR liste et le COD arrondi', () => {
  const c = construireColisColivraison(colis(), 'Aourir-bm');
  assert.equal(c.fullname, 'Amina Alaoui');
  assert.equal(c.phone, '0612345678');
  assert.equal(c.city, 'Aourir-bm');
  assert.equal(c.address, '12 rue des Oliviers');
  assert.equal(c.price, '250');
  assert.equal(c.qty, '2');
  assert.equal(c.openpackage, '1');
  assert.equal(c.change, '0');
});

// Paramètre OBLIGATOIRE bien qu'absent de leur doc : sans lui, « Some
// parameter are missing » (première remise réelle, 01/10/2026).
test('notre code part dans le paramètre `code`', () => {
  assert.equal(construireColisColivraison(colis(), 'X').code, 'MTH-PD-000123');
});

test('notre code part en tête de la note : c’est la clé de rapprochement', () => {
  assert.match(construireColisColivraison(colis(), 'X').note, /^Réf MTH-PD-000123/);
  assert.match(construireColisColivraison(colis({ fragile: true }), 'X').note, /fragile/);
});

test('une virgule dans la description ne crée pas un second produit', () => {
  assert.equal(construireColisColivraison(colis(), 'X').product, 'Robe  ceinture');
  assert.equal(construireColisColivraison(colis({ produitDescription: null }), 'X').product, 'Colis');
});

test('un échange part avec change=1, un colis fermé avec openpackage=0', () => {
  const c = construireColisColivraison(colis({ aRemplacer: true, ouvrir: false }), 'X');
  assert.equal(c.change, '1');
  assert.equal(c.openpackage, '0');
});

test('un COD invalide est refusé avant tout appel', () => {
  assert.throws(() => construireColisColivraison(colis({ montantCod: 'abc' }), 'X'));
  assert.throws(() => construireColisColivraison(colis({ montantCod: -5 }), 'X'));
});

// ------------------------------------------------------------
// Lecture des réponses — formes relevées le 01/10/2026
// ------------------------------------------------------------

test('leur message est lu sous toutes ses formes', () => {
  assert.equal(messageColivraison({ message: 'Some parameter are missing' }), 'Some parameter are missing');
  assert.equal(messageColivraison(["This account doesn't exist or it is disabled"]), "This account doesn't exist or it is disabled");
  assert.equal(messageColivraison({ message: "Code doesn't exist or incorrect credentials", status: '404' }), "Code doesn't exist or incorrect credentials");
  assert.equal(messageColivraison([{ Etat: 'Nouveau' }]), null);
});

test('seul « Package added succesfully » est une création réussie, quel que soit le code HTTP', () => {
  assert.ok(creationReussie({ message: 'Package added succesfully' }));
  assert.ok(creationReussie(['Package added successfully']));
  assert.ok(!creationReussie({ message: 'Some parameter are missing' }));
  assert.ok(!creationReussie({ message: "This account doesn't exist or it is disabled" }));
  assert.ok(!creationReussie(null));
});

test('leur code est cherché dans la réponse de création, sinon null', () => {
  assert.equal(codeExterneDeReponse({ message: 'Package added succesfully', code: 'CL123' }), 'CL123');
  assert.equal(codeExterneDeReponse({ message: 'ok', data: { Code_Colis: 'CL9' } }), 'CL9');
  assert.equal(codeExterneDeReponse({ message: 'Package added succesfully' }), null);
});

test('le suivi retient l’état le plus RÉCENT, quel que soit l’ordre reçu', () => {
  const suivi = lireSuiviColivraison([
    { Etat: 'Nouveau', Date_Evenement: '1610816442' },
    { Etat: 'Expédié', Date_Evenement: '1610824063' },
    { Etat: 'Prèt pour expédition', Date_Evenement: '1610819137' },
  ]);
  assert.equal(suivi.etat, 'Expédié');
  assert.equal(suivi.date?.getTime(), 1610824063 * 1000);
  assert.equal(suivi.historique.length, 3);
  assert.equal(lireSuiviColivraison([]).etat, null);
});

// Forme RÉELLE, relevée sur le premier colis remis (01/10/2026).
test('le suivi réel — objet à clés numériques — est lu, livreur compris', () => {
  const suivi = lireSuiviColivraison({
    0: { state: 'Ajouter', eventdate: '1790865035' },
    1: { state: 'Livré', eventdate: '1790900000' },
    nom_liveur: 'Karim',
    telephone_liveur: null,
    status: '200',
  });
  assert.equal(suivi.etat, 'Livré');
  assert.equal(suivi.historique.length, 2);
  assert.equal(suivi.livreur, 'Karim');
  assert.equal(lireSuiviColivraison({ message: "Code doesn't exist or incorrect credentials", status: '404' }).historique.length, 0);
});

test('la liste réelle donne leur code dans `Code`, le nôtre dans `IDIntern`', () => {
  const lignes = lignesDeListe([
    { Code: 'CLV24-01102026-3206613', IDIntern: 'MTH-PD-101720', Note: 'Réf MTH-PD-101720', State: 'Ajouter' },
  ]);
  assert.equal(codeDansListe(lignes, 'MTH-PD-101720'), 'CLV24-01102026-3206613');
});

test('leur code est retrouvé dans la liste grâce à notre référence en note', () => {
  const lignes = lignesDeListe([
    { Code: 'CL1', Note: 'Réf MTH-PD-000001' },
    { Code: 'CL2', Note: 'Réf MTH-PD-000123 — Colis fragile' },
  ]);
  assert.equal(codeDansListe(lignes, 'MTH-PD-000123'), 'CL2');
  assert.equal(codeDansListe(lignes, 'MTH-PD-999999'), null);
  assert.equal(lignesDeListe({ data: [{ Code: 'X' }] }).length, 1);
});

// ------------------------------------------------------------
// États
// ------------------------------------------------------------

test('les états de leur documentation sont de la logistique interne', () => {
  for (const etat of ['Ajouter', 'Nouveau', 'Collecté par agence principale', 'Prèt pour expédition', 'Expédié']) {
    assert.deepEqual(sortStatutColivraison(etat), { sort: 'memoriser' }, etat);
  }
});

test('les issues de livraison sont appliquées', () => {
  assert.deepEqual(sortStatutColivraison('Livré'), { sort: 'appliquer', statut: 'livre' });
  assert.deepEqual(sortStatutColivraison('LIVRE'), { sort: 'appliquer', statut: 'livre' });
  assert.deepEqual(sortStatutColivraison('Refusé'), { sort: 'appliquer', statut: 'refuse' });
  assert.deepEqual(sortStatutColivraison('Reporté'), { sort: 'appliquer', statut: 'reporte' });
  assert.deepEqual(sortStatutColivraison('Annulé'), { sort: 'appliquer', statut: 'annule' });
  assert.deepEqual(sortStatutColivraison('Mise en distribution'), { sort: 'appliquer', statut: 'mise_en_distribution' });
  assert.deepEqual(sortStatutColivraison('Retourné'), { sort: 'appliquer', statut: 'en_retour_par_amana' });
  assert.deepEqual(sortStatutColivraison('Injoignable'), { sort: 'appliquer', statut: 'injoignable' });
  assert.deepEqual(sortStatutColivraison('Hors zone'), { sort: 'appliquer', statut: 'hors_zone' });
});

test('« Non livré » n’est JAMAIS une livraison, et l’inconnu n’est pas deviné', () => {
  assert.deepEqual(sortStatutColivraison('Non livré'), { sort: 'inconnu' });
  assert.deepEqual(sortStatutColivraison('Livraison en attente de paiement'), { sort: 'inconnu' });
  assert.deepEqual(sortStatutColivraison('Quelque chose de nouveau'), { sort: 'inconnu' });
  assert.deepEqual(sortStatutColivraison(''), { sort: 'inconnu' });
});
