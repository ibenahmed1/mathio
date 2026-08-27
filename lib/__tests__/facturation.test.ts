import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculerFacture,
  tarifPourColis,
  type ColisFacturable,
  type TarifsMarchand,
} from '../facturation';

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

// `calculerFacture` ne lit que quatre champs du colis (id, statut, villeId,
// montantCod) alors que ColisFacturable est le payload Prisma complet d'une
// Commande. Construire l'objet entier n'apporterait rien et rendrait chaque
// test illisible : on fabrique le strict nécessaire et on cast. Le jour où la
// fonction lira un cinquième champ, TypeScript ne préviendra pas — mais le
// test échouera, ce qui est le rôle du test.
function colis(
  id: string,
  statut: 'livre' | 'retourne',
  montantCod: number | string,
  villeId: string | null = null
): ColisFacturable {
  return { id, statut, montantCod, villeId } as unknown as ColisFacturable;
}

function tarifs(
  defautLivraison: number,
  defautRetour: number,
  parVille: Record<string, { livraison: number; retour: number }> = {}
): TarifsMarchand {
  return {
    parVilleId: new Map(Object.entries(parVille)),
    defautLivraison,
    defautRetour,
  };
}

// ------------------------------------------------------------
// Grille tarifaire
// ------------------------------------------------------------

test('tarifPourColis : le tarif de la ville prime sur le tarif par défaut', () => {
  const t = tarifs(30, 15, { casa: { livraison: 25, retour: 10 } });

  assert.equal(tarifPourColis(t, 'casa', 'livraison'), 25);
  assert.equal(tarifPourColis(t, 'casa', 'retour'), 10);
});

test('tarifPourColis : ville hors grille ou non résolue retombe sur le défaut', () => {
  const t = tarifs(30, 15, { casa: { livraison: 25, retour: 10 } });

  // Ville connue du référentiel mais sans tarif négocié.
  assert.equal(tarifPourColis(t, 'agadir', 'livraison'), 30);
  // villeId null : Commande.ville est un champ texte libre dont la résolution
  // vers le référentiel est best-effort. Facturer 0 serait pire que facturer
  // le tarif de base — c'est le choix documenté dans lib/facturation.ts.
  assert.equal(tarifPourColis(t, null, 'livraison'), 30);
  assert.equal(tarifPourColis(t, null, 'retour'), 15);
});

// ------------------------------------------------------------
// Calcul de facture
// ------------------------------------------------------------

test('facture nominale : COD des livrés moins frais de livraison et de retour', () => {
  const f = calculerFacture(
    [
      colis('c1', 'livre', 250),
      colis('c2', 'livre', 400),
      colis('c3', 'retourne', 300),
    ],
    tarifs(30, 15)
  );

  assert.equal(f.nbColisLivres, 2);
  assert.equal(f.nbColisRetournes, 1);
  assert.equal(f.totalCod, 650);
  assert.equal(f.totalFraisLivraison, 60);
  assert.equal(f.totalFraisRetour, 15);
  assert.equal(f.netAPayer, 650 - 60 - 15);
});

// LE test qui justifie tout ce fichier : un colis retourné n'a jamais été
// encaissé. Le compter dans le COD reviendrait à verser au marchand de
// l'argent que la plateforme n'a jamais reçu — l'erreur la plus coûteuse que
// ce module puisse commettre, et la plus silencieuse.
test('un colis retourné n’apporte aucun COD, même avec un montant renseigné', () => {
  const f = calculerFacture([colis('c1', 'retourne', 999)], tarifs(30, 15));

  assert.equal(f.totalCod, 0);
  assert.equal(f.totalFraisLivraison, 0);
  assert.equal(f.totalFraisRetour, 15);
  assert.equal(f.netAPayer, -15);
  assert.equal(f.lignes[0].montantCod, 0);
  assert.equal(f.lignes[0].livre, false);
});

test('un colis retourné est facturé au tarif RETOUR, jamais au tarif livraison', () => {
  const t = tarifs(30, 15, { casa: { livraison: 25, retour: 10 } });
  const f = calculerFacture([colis('c1', 'retourne', 0, 'casa')], t);

  assert.equal(f.lignes[0].frais, 10);
  assert.equal(f.totalFraisRetour, 10);
});

test('chaque ligne porte le tarif de SA ville, pas un tarif moyen', () => {
  const t = tarifs(30, 15, { casa: { livraison: 25, retour: 10 } });
  const f = calculerFacture(
    [colis('c1', 'livre', 100, 'casa'), colis('c2', 'livre', 100, 'agadir')],
    t
  );

  assert.equal(f.lignes[0].frais, 25);
  assert.equal(f.lignes[1].frais, 30);
  assert.equal(f.totalFraisLivraison, 55);
});

test('net négatif conservé tel quel : c’est une dette du marchand, pas un zéro', () => {
  // Que des retours : la plateforme n'a rien encaissé mais a rendu un service.
  const f = calculerFacture(
    [colis('c1', 'retourne', 0), colis('c2', 'retourne', 0)],
    tarifs(30, 15)
  );

  assert.equal(f.netAPayer, -30);
});

test('les frais annexes sont toujours déduits, quel que soit le signe saisi', () => {
  // Le montant est pris en valeur absolue : saisir -50 ne doit pas créditer
  // le marchand de 50 par inadvertance.
  const positif = calculerFacture([colis('c1', 'livre', 500)], tarifs(30, 15), [
    { libelle: 'Stockage', montant: 50 },
  ]);
  const negatif = calculerFacture([colis('c1', 'livre', 500)], tarifs(30, 15), [
    { libelle: 'Stockage', montant: -50 },
  ]);

  assert.equal(positif.totalAutresFrais, 50);
  assert.equal(positif.netAPayer, 500 - 30 - 50);
  assert.deepEqual(negatif, positif);
});

test('facture vide : tous les totaux à zéro, aucune ligne', () => {
  const f = calculerFacture([], tarifs(30, 15));

  assert.deepEqual(f, {
    lignes: [],
    nbColisLivres: 0,
    nbColisRetournes: 0,
    totalCod: 0,
    totalFraisLivraison: 0,
    totalFraisRetour: 0,
    totalAutresFrais: 0,
    netAPayer: 0,
  });
});

// ------------------------------------------------------------
// Intégrité comptable
// ------------------------------------------------------------

// Les montants sont stockés en Decimal(12,2) et la facture est imprimée ligne
// par ligne : le total doit être EXACTEMENT la somme des lignes affichées,
// sinon le marchand voit un document qui ne s'additionne pas.
test('aucune dérive de centime : les totaux égalent la somme des lignes', () => {
  const lignes = Array.from({ length: 300 }, (_, i) =>
    colis(`c${i}`, i % 3 === 0 ? 'retourne' : 'livre', 33.33)
  );
  const f = calculerFacture(lignes, tarifs(10.1, 5.05));

  const sommeCod = f.lignes.reduce((s, l) => s + l.montantCod, 0);
  const sommeFraisLivraison = f.lignes
    .filter((l) => l.livre)
    .reduce((s, l) => s + l.frais, 0);
  const sommeFraisRetour = f.lignes
    .filter((l) => !l.livre)
    .reduce((s, l) => s + l.frais, 0);

  assert.equal(f.totalCod, Number(sommeCod.toFixed(2)));
  assert.equal(f.totalFraisLivraison, Number(sommeFraisLivraison.toFixed(2)));
  assert.equal(f.totalFraisRetour, Number(sommeFraisRetour.toFixed(2)));
  assert.equal(
    f.netAPayer,
    Number((f.totalCod - f.totalFraisLivraison - f.totalFraisRetour).toFixed(2))
  );
});

// Prisma renvoie les Decimal sous forme d'objet, jamais de number : le calcul
// doit accepter ce que la base rend réellement.
test('montantCod fourni en chaîne (Decimal Prisma) est traité comme un nombre', () => {
  const f = calculerFacture([colis('c1', 'livre', '250.50')], tarifs(30, 15));

  assert.equal(f.totalCod, 250.5);
  assert.equal(f.netAPayer, 220.5);
});
