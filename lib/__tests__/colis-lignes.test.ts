import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LONGUEUR_MAX_RESUME, descriptionContenu, quantiteTotale, resumerLignes } from '../colis-lignes';

test('une seule ligne : le libellé seul, la quantité à part', () => {
  assert.deepEqual(resumerLignes([{ libelle: 'Mug', quantite: 3 }]), { quantite: 3, produitDescription: 'Mug' });
});

test('plusieurs lignes : « q × libellé » dans l’ordre, quantités additionnées', () => {
  const lignes = [
    { libelle: 'Robe — Rouge', quantite: 2 },
    { libelle: 'Mug', quantite: 1 },
  ];
  assert.equal(descriptionContenu(lignes), '2 × Robe — Rouge, 1 × Mug');
  assert.equal(quantiteTotale(lignes), 3);
});

test('sans ligne : pas de description inventée, quantité plancher à 1', () => {
  // `commandes.quantite` vaut au moins 1 partout ailleurs dans l'application.
  assert.deepEqual(resumerLignes([]), { quantite: 1, produitDescription: null });
});

test('une description trop longue est tronquée avec une ellipse', () => {
  const lignes = Array.from({ length: 100 }, (_, i) => ({ libelle: `Produit numéro ${i}`, quantite: 1 }));
  const texte = descriptionContenu(lignes)!;
  assert.equal(texte.length, LONGUEUR_MAX_RESUME);
  assert.ok(texte.endsWith('…'));
});
