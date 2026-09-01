import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculerFacture,
  margeFacture,
  tarifPourColis,
  type ColisFacturable,
  type TarifsMarchand,
} from '../facturation';
import type { CoutsPrestataire } from '../prestataires';

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
  villeId: string | null = null,
  // Frais figés à la clôture de tournée. Absent = colis jamais passé par un
  // bon de distribution, donc coût à chercher du côté de la sous-traitance.
  fraisLivreur: number | null = null
): ColisFacturable {
  return { id, statut, montantCod, villeId, fraisLivreur } as unknown as ColisFacturable;
}

function couts(
  parVille: Record<string, { livraison: number; retour: number | null }>
): CoutsPrestataire {
  return new Map(Object.entries(parVille));
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
    totalCoutLivraison: 0,
    nbLignesCoutInconnu: 0,
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

// ------------------------------------------------------------
// Coût de la course et marge (§ sous-traitance)
// ------------------------------------------------------------

test('le coût figé du livreur prime sur la grille du prestataire', () => {
  // Ville sous-traitée à 25, mais le colis a bien été livré par un livreur
  // maison payé 18 : c'est 18 qui a été réellement déboursé.
  const f = calculerFacture([colis('c1', 'livre', 400, 'marrakech', 18)], tarifs(30, 15), [], couts({
    marrakech: { livraison: 25, retour: 12 },
  }));

  assert.equal(f.lignes[0].coutLivraison, 18);
  assert.equal(f.lignes[0].coutSource, 'livreur');
  assert.equal(f.totalCoutLivraison, 18);
  assert.equal(f.nbLignesCoutInconnu, 0);
});

test('sans frais livreur, le coût vient de la grille du prestataire de la ville', () => {
  const grille = couts({ marrakech: { livraison: 25, retour: 12 } });

  const livre = calculerFacture([colis('c1', 'livre', 400, 'marrakech')], tarifs(30, 15), [], grille);
  assert.equal(livre.lignes[0].coutLivraison, 25);
  assert.equal(livre.lignes[0].coutSource, 'prestataire');

  // Un retour se paie au tarif de retour, pas au tarif de livraison.
  const retour = calculerFacture([colis('c2', 'retourne', 400, 'marrakech')], tarifs(30, 15), [], grille);
  assert.equal(retour.lignes[0].coutLivraison, 12);
  assert.equal(retour.totalCoutLivraison, 12);
});

test('coût inconnu : null et jamais 0, et la facture le compte', () => {
  const f = calculerFacture(
    [
      // Ville non couverte par une agence, et jamais passée en tournée.
      colis('c1', 'livre', 400, 'tanger'),
      // Ville d'agence dont le tarif de RETOUR n'est pas renseigné : le
      // fournisseur ne l'a pas chiffré, on ne l'invente pas.
      colis('c2', 'retourne', 400, 'marrakech'),
      colis('c3', 'livre', 400, 'marrakech'),
    ],
    tarifs(30, 15),
    [],
    couts({ marrakech: { livraison: 25, retour: null } })
  );

  assert.equal(f.lignes[0].coutLivraison, null);
  assert.equal(f.lignes[0].coutSource, null);
  assert.equal(f.lignes[1].coutLivraison, null);
  assert.equal(f.lignes[2].coutLivraison, 25);
  // Seuls les coûts CONNUS sont sommés — un inconnu compté 0 gonflerait la marge.
  assert.equal(f.totalCoutLivraison, 25);
  assert.equal(f.nbLignesCoutInconnu, 2);
});

// Un colis fabriqué sans la colonne `fraisLivreur` (select partiel, fixture)
// ne doit pas produire un coût NaN qui contaminerait tout le total en silence.
test('fraisLivreur absent est traité comme inconnu, pas comme NaN', () => {
  const partiel = { id: 'c1', statut: 'livre', montantCod: 400, villeId: null } as unknown as ColisFacturable;
  const f = calculerFacture([partiel], tarifs(30, 15));

  assert.equal(f.lignes[0].coutLivraison, null);
  assert.equal(f.totalCoutLivraison, 0);
  assert.equal(f.nbLignesCoutInconnu, 1);
});

test('la marge est le produit des frais moins le coût, le COD exclu', () => {
  // Facturé 30 au marchand, payé 18 au livreur : 12 de marge. Les 400 de COD
  // appartiennent au marchand et n'entrent dans aucun des deux termes.
  const f = calculerFacture([colis('c1', 'livre', 400, 'casa', 18)], tarifs(30, 15));

  assert.deepEqual(margeFacture(f), { marge: 12, fiable: true });
});

test('la marge est signalée NON FIABLE dès qu’un coût manque', () => {
  const f = calculerFacture(
    [colis('c1', 'livre', 400, 'casa', 18), colis('c2', 'livre', 400, 'tanger')],
    tarifs(30, 15)
  );

  // 60 facturés, 18 payés : la marge affichée dit 42, mais un colis n'a pas
  // encore livré son coût — le drapeau est là pour empêcher de la lire comme
  // un résultat.
  assert.deepEqual(margeFacture(f), { marge: 42, fiable: false });
});

test('marge négative : un colis vendu moins cher qu’il ne coûte reste lisible', () => {
  const f = calculerFacture([colis('c1', 'livre', 400, 'casa', 35)], tarifs(30, 15));

  assert.equal(margeFacture(f).marge, -5);
});
