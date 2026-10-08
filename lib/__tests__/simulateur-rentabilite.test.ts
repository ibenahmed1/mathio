import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ENTREES_DEFAUT,
  TAUX_DEFAUT,
  convertir,
  cplMarketing,
  analyserScenario,
  courbeProfit,
  podium,
  normaliserEntrees,
  normaliserNomSimulation,
  normaliserTaux,
  parametres,
  simuler,
  tauxLivraisonSeuil,
  verdict,
  type Parametres,
} from '../simulateur-rentabilite';

// Cas calculé à la main, ligne à ligne : 100 prospects, 50 confirmées,
// 30 livrées, 20 retournées dont 2 invendables.
const BASE: Parametres = {
  prixVente: 200,
  coutUnitaire: 50,
  budgetPub: 1000,
  cpl: 10,
  tauxConfirmation: 0.5,
  tauxLivraison: 0.6,
  baseCallCenter: 'confirmee',
  coutCallCenter: 5,
  fraisEmballage: 4,
  fraisLivraison: 30,
  fraisRetour: 10,
  tauxPerteRetours: 0.1,
  acompte: 0,
};

const proche = (a: number | null, b: number, eps = 1e-9) =>
  assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('la cascade prospects → confirmées → livrées → retournées', () => {
  const r = simuler(BASE);
  proche(r.prospects, 100);
  proche(r.confirmees, 50);
  proche(r.livrees, 30);
  proche(r.retournees, 20);
});

test('les coûts : produit sur les livrées + retours perdus, jamais sur les retours revendables', () => {
  const r = simuler(BASE);
  proche(r.couts.produit, 32 * 50);
  proche(r.couts.produitPerdu, 2 * 50);
  proche(r.couts.callCenter, 50 * 5);
  proche(r.couts.emballage, 50 * 4);
  proche(r.couts.livraison, 30 * 30);
  proche(r.couts.retour, 20 * 10);
  proche(r.coutsHorsPub, 3150);
});

test('CA, profit, marge, CAC et ROAS', () => {
  const r = simuler(BASE);
  proche(r.ca, 6000);
  proche(r.profit, 1850);
  proche(r.margeNette, 1850 / 6000);
  proche(r.cacReel, 1000 / 30);
  proche(r.roas, 6);
  proche(r.profitParLivree, 1850 / 30);
});

test('le call center facturé au prospect compte TOUS les appels', () => {
  const r = simuler({ ...BASE, baseCallCenter: 'prospect', coutCallCenter: 2 });
  proche(r.couts.callCenter, 200);
});

test('au ROAS de rentabilité, le profit est nul — quel que soit le budget', () => {
  const r = simuler(BASE);
  proche(r.roasSeuil, 6000 / 2850);
  // Le budget qui donne exactement ce ROAS, à CPL inchangé, donne un profit nul.
  const cplSeuil = BASE.cpl * (r.roas! / r.roasSeuil!);
  proche(simuler({ ...BASE, cpl: cplSeuil }).profit, 0, 1e-6);
  proche(simuler({ ...BASE, budgetPub: 5000 }).roasSeuil, r.roasSeuil!);
});

test('le CPL maximal annule le profit', () => {
  const r = simuler(BASE);
  proche(r.cplMax, 28.5);
  proche(simuler({ ...BASE, cpl: 28.5 }).profit, 0, 1e-6);
});

test('le taux de livraison seuil annule le profit', () => {
  const seuil = tauxLivraisonSeuil(BASE);
  proche(seuil, 22 / 67.5);
  proche(simuler({ ...BASE, tauxLivraison: seuil! }).profit, 0, 1e-6);
});

test('un prix qui ne couvre pas les coûts : aucun seuil n’existe', () => {
  const p = { ...BASE, prixVente: 40 };
  const r = simuler(p);
  assert.equal(r.roasSeuil, null);
  assert.equal(r.cplMax, null);
  assert.equal(tauxLivraisonSeuil(p), null);
  assert.equal(verdict(p, r).statut, 'marge_incoherente');
});

test('l’acompte gardé sur les retours entre dans le CA', () => {
  const r = simuler({ ...BASE, acompte: 20 });
  proche(r.acomptesRetenus, 20 * 20);
  proche(r.ca, 6000 + 400);
});

test('l’acompte est plafonné au prix et le scénario prend ses propres taux', () => {
  const e = {
    ...ENTREES_DEFAUT,
    montantAcompte: 9999,
    prixVente: 100,
    tauxConfirmationAcompte: 40,
    tauxLivraisonAcompte: 90,
  };
  const p = parametres(e, TAUX_DEFAUT, { avecAcompte: true });
  assert.equal(p.acompte, 100);
  proche(p.tauxConfirmation, 0.4);
  proche(p.tauxLivraison, 0.9);
  assert.equal(parametres(e, TAUX_DEFAUT).acompte, 0);
});

test('budget nul ou CPL nul : aucun prospect, aucun ratio inventé', () => {
  for (const p of [
    { ...BASE, budgetPub: 0 },
    { ...BASE, cpl: 0 },
  ]) {
    const r = simuler(p);
    assert.equal(r.prospects, 0);
    assert.equal(r.ca, 0);
    assert.equal(r.margeNette, null);
    assert.equal(r.cacReel, null);
  }
});

test('conversion de devises par le pivot MAD', () => {
  const taux = { ...TAUX_DEFAUT, USD: 10, EUR: 11 };
  proche(convertir(5, 'USD', 'MAD', taux), 50);
  proche(convertir(50, 'MAD', 'USD', taux), 5);
  proche(convertir(11, 'USD', 'EUR', taux), 10);
  // Les ancrages officiels : 1 EUR = 655,957 XOF.
  proche(convertir(1, 'EUR', 'XOF', TAUX_DEFAUT), 655.957, 1e-2);
});

test('les montants saisis en devise étrangère sont convertis en devise de vente', () => {
  const taux = { ...TAUX_DEFAUT, USD: 10 };
  const e = {
    ...ENTREES_DEFAUT,
    prixAchat: 4,
    fraisApproche: 1,
    deviseAchat: 'USD' as const,
    deviseApproche: 'MAD' as const,
    budgetPub: 100,
    cpl: 2,
  };
  const p = parametres(e, taux);
  proche(p.coutUnitaire, 41);
  proche(p.budgetPub, 1000);
  proche(p.cpl, 20);
});

test('le CPL avancé se déduit du CPM, du CTR et de la conversion', () => {
  const e = { ...ENTREES_DEFAUT, modeCpl: 'avance' as const, cpm: 10, ctr: 2, tauxConversionPage: 10 };
  // 1000 impressions = 10 $ → 20 clics → 2 prospects → 5 $ le prospect.
  proche(cplMarketing(e), 5);
  assert.equal(cplMarketing({ ...e, ctr: 0 }), 0);
});

test('la courbe de stress-test croise zéro au seuil', () => {
  const courbe = courbeProfit(BASE, 20, 100, 1);
  assert.equal(courbe.length, 81);
  const avant = courbe.find((pt) => pt.taux === 32)!;
  const apres = courbe.find((pt) => pt.taux === 33)!;
  assert.ok(avant.profit < 0 && apres.profit > 0);
});

test('verdicts', () => {
  assert.equal(verdict(BASE, simuler(BASE)).statut, 'viable');
  // Rentable mais à moins de 10 points du seuil (≈ 32,6 %).
  const fragile = { ...BASE, tauxLivraison: 0.4 };
  assert.equal(verdict(fragile, simuler(fragile)).statut, 'risque_logistique');
  // À perte, mais un taux de livraison atteignable suffirait.
  const bas = { ...BASE, tauxLivraison: 0.25 };
  assert.equal(verdict(bas, simuler(bas)).statut, 'risque_logistique');
  // À perte et il faudrait plus de 85 % de livraison.
  const cher = { ...BASE, cpl: 50 };
  assert.equal(verdict(cher, simuler(cher)).statut, 'marge_incoherente');
});

// --- Divisions par zéro ------------------------------------------------------
//
// Aucune saisie, si absurde soit-elle, ne doit faire sortir un NaN ou un
// Infinity : l'écran afficherait « NaN MAD ».

function sansNaNNiInfini(r: ReturnType<typeof simuler>) {
  const visiter = (v: unknown, chemin: string) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${chemin} = ${v}`);
    else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) visiter(w, `${chemin}.${k}`);
  };
  visiter(r, 'résultats');
}

test('CPL nul : simulation incomplète, aucun chiffre trompeur', () => {
  const r = simuler({ ...BASE, cpl: 0 });
  sansNaNNiInfini(r);
  assert.equal(r.complet, false);
  assert.deepEqual(r.manquants, ['coût par prospect']);
  for (const k of ['roas', 'roasSeuil', 'cacReel', 'cplMax', 'tauxLivraisonSeuil', 'margeNette'] as const) {
    assert.equal(r[k], null, k);
  }
});

test('prix ou budget nuls : simulation incomplète', () => {
  assert.deepEqual(simuler({ ...BASE, prixVente: 0, budgetPub: 0 }).manquants, [
    'prix de vente',
    'budget publicitaire',
  ]);
});

test('0 % de confirmation : calculé, sans NaN, et le verdict en donne la vraie raison', () => {
  const p = { ...BASE, tauxConfirmation: 0 };
  const r = simuler(p);
  sansNaNNiInfini(r);
  assert.equal(r.complet, true);
  assert.equal(r.livrees, 0);
  assert.equal(r.cacReel, null);
  assert.equal(r.roasSeuil, null);
  assert.equal(r.tauxLivraisonSeuil, null);
  assert.match(verdict(p, r).raisons[0], /Aucune commande confirmée/);
});

test('0 % de livraison : calculé, sans NaN, seuil toujours donné', () => {
  const p = { ...BASE, tauxLivraison: 0 };
  const r = simuler(p);
  sansNaNNiInfini(r);
  assert.equal(r.cacReel, null);
  assert.equal(r.margeNette, null);
  proche(r.tauxLivraisonSeuil, 22 / 67.5);
  assert.equal(verdict(p, r).statut, 'risque_logistique');
});

test('taux de change nul ou saisies non numériques : rien ne déborde', () => {
  const e = { ...ENTREES_DEFAUT, cpl: Number.NaN, prixVente: Infinity, tauxLivraison: Number.NaN };
  sansNaNNiInfini(simuler(parametres(e, { ...TAUX_DEFAUT, USD: 0 })));
});

test('les retours intacts réintègrent le stock sans coût produit', () => {
  const r = simuler(BASE);
  proche(r.retoursPerdus, 2);
  proche(r.retoursRemisEnStock, 18);
  // Coût produit = (livrés + invendables) × coût unitaire, rien pour les 18 autres.
  proche(r.couts.produit, (r.livrees + r.retoursPerdus) * BASE.coutUnitaire);
});

// --- Scénarios enregistrés ---------------------------------------------------

test('normaliserEntrees : défauts pour l’absent, rejet de l’illisible, rien d’inconnu', () => {
  const e = normaliserEntrees({
    prixVente: 199,
    cpl: 'abc',
    budgetPub: Infinity,
    deviseAchat: 'BTC',
    deviseVente: 'EUR',
    modeCpl: 'avance',
    baseCallCenter: 'nimporte',
    acompteActif: 'oui',
    champPirate: 42,
  });
  assert.equal(e.prixVente, 199);
  assert.equal(e.cpl, ENTREES_DEFAUT.cpl);
  assert.equal(e.budgetPub, ENTREES_DEFAUT.budgetPub);
  assert.equal(e.deviseAchat, ENTREES_DEFAUT.deviseAchat);
  assert.equal(e.deviseVente, 'EUR');
  assert.equal(e.modeCpl, 'avance');
  assert.equal(e.baseCallCenter, ENTREES_DEFAUT.baseCallCenter);
  assert.equal(e.acompteActif, false);
  assert.ok(!('champPirate' in e));
  assert.deepEqual(normaliserEntrees(null), ENTREES_DEFAUT);
});

test('normaliserTaux : taux positifs seulement, MAD toujours à 1', () => {
  const t = normaliserTaux({ USD: 10, EUR: -3, CNY: 'x', MAD: 5 });
  assert.equal(t.USD, 10);
  assert.equal(t.EUR, TAUX_DEFAUT.EUR);
  assert.equal(t.CNY, TAUX_DEFAUT.CNY);
  assert.equal(t.MAD, 1);
});

test('normaliserNomSimulation', () => {
  assert.equal(normaliserNomSimulation('  Montre   X8 '), 'Montre X8');
  assert.equal(normaliserNomSimulation('   '), null);
  assert.equal(normaliserNomSimulation(42), null);
  assert.equal(normaliserNomSimulation('a'.repeat(121)), null);
});

// --- Comparaison --------------------------------------------------------------

test('podium : 1re et 2e place, ex aequo, et rien quand rien ne se distingue', () => {
  const rang = (v: (number | null)[], sens: 'max' | 'min') => Object.fromEntries(podium(v, sens));
  assert.deepEqual(rang([3, 7, null, 5], 'max'), { 1: 1, 3: 2 });
  assert.deepEqual(rang([3, 7, 1], 'min'), { 2: 1, 0: 2 });
  // Ex aequo en tête : ils partagent la 1re place, la 2e est la valeur suivante.
  assert.deepEqual(rang([7, 7, 5, 1], 'max'), { 0: 1, 1: 1, 2: 2 });
  // Deux produits : pas de 2e place, ce serait « dernier ».
  assert.deepEqual(rang([3, 7], 'max'), { 1: 1 });
  // Les suivants tous ex aequo derrière le premier : pas de 2e place non plus.
  assert.deepEqual(rang([9, 4, 4], 'max'), { 0: 1 });
  assert.equal(podium([5, 5, 5], 'max').size, 0);
  assert.equal(podium([5, null, Number.NaN], 'max').size, 0);
});

test('analyserScenario : mêmes chiffres que la cascade, marge de sécurité en fraction', () => {
  const a = analyserScenario(ENTREES_DEFAUT, TAUX_DEFAUT);
  const r = simuler(parametres(ENTREES_DEFAUT, TAUX_DEFAUT));
  proche(a.resultats.profit, r.profit);
  proche(a.margeSecuriteLivraison, ENTREES_DEFAUT.tauxLivraison / 100 - r.tauxLivraisonSeuil!);
  assert.ok(a.verdict);
  assert.equal(analyserScenario({ ...ENTREES_DEFAUT, cpl: 0 }, TAUX_DEFAUT).verdict, null);
});
