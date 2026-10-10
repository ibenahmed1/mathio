import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { nextCodeSuivi } from '../lib/codes';
import { reserverStockColis, reintegrerStockColis, verifierUniteStock } from '../lib/stock-colis';
import { resoudreSku, skuDejaPris } from '../lib/stock-sku';

// Audit local du stock par variante (§ Gestion de stock), sur la vraie base :
// `npx tsx scripts/test-stock-variantes-audit.ts`. Exerce les fonctions que
// les routes appellent réellement (lib/stock-colis.ts, lib/stock-sku.ts) :
//  1. espace de noms des SKU (produit + variante, sans casse) ;
//  2. résolution d'un SKU de variante (import Excel mode « stock ») ;
//  3. rattachement d'un colis : variante exigée sur un produit à variantes ;
//  4. réservation au passage en préparation : variante décrémentée, colis
//     sans produit refusé, stock insuffisant refusé en tout ou rien ;
//  5. réintégration : stock rendu une seule fois.
// Toutes les données créées sont préfixées et supprimées en fin d'exécution.

const PREFIXE = `AUDIT-VAR-${Date.now()}`;
let reussis = 0;
let echoues = 0;

async function verifie(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    reussis++;
    console.log(`  ✅ ${label}`);
  } catch (err) {
    echoues++;
    console.error(`  ❌ ${label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function rejette(fn: () => Promise<unknown>, motif: RegExp) {
  await assert.rejects(fn, (err: Error) => motif.test(err.message));
}

async function main() {
  const admin = await prisma.utilisateur.findFirstOrThrow({ where: { role: 'admin' } });
  const marchand = await prisma.marchand.findFirstOrThrow();

  const robe = await prisma.produit.create({
    data: {
      marchandId: marchand.id,
      nom: `${PREFIXE} Robe`,
      reference: `${PREFIXE}-ROBE`,
      statutReception: 'recu',
      variantesActivees: true,
      variantes: {
        create: [
          { nom: 'Rouge', reference: `${PREFIXE}-ROBE-ROUGE`, quantiteRecue: 5 },
          { nom: 'Bleu', reference: `${PREFIXE}-ROBE-BLEU`, quantiteRecue: 1 },
        ],
      },
    },
    include: { variantes: true },
  });
  const rouge = robe.variantes.find((v) => v.nom === 'Rouge')!;
  const bleu = robe.variantes.find((v) => v.nom === 'Bleu')!;
  const colisIds: string[] = [];

  async function creerColis(data: { produitId?: string | null; varianteId?: string | null; quantite: number }) {
    const c = await prisma.commande.create({
      data: {
        codeSuivi: await nextCodeSuivi(),
        marchandId: marchand.id,
        clientNom: PREFIXE,
        clientTelephone: '0600000000',
        ville: 'Casablanca',
        adresse: PREFIXE,
        montantCod: 100,
        enStock: true,
        produitId: data.produitId ?? null,
        varianteId: data.varianteId ?? null,
        quantite: data.quantite,
      },
      select: {
        id: true,
        codeSuivi: true,
        quantite: true,
        produitId: true,
        varianteId: true,
        produit: { select: { nom: true, variantesActivees: true } },
      },
    });
    colisIds.push(c.id);
    return c;
  }

  try {
    console.log('1. Espace de noms des SKU');
    await verifie('un SKU de variante est pris, quelle que soit la casse', async () => {
      const saisi = `${PREFIXE}-robe-rouge`.toLowerCase();
      assert.equal(await skuDejaPris(marchand.id, [saisi]), saisi);
    });
    await verifie('un SKU libre est libre', async () => {
      assert.equal(await skuDejaPris(marchand.id, [`${PREFIXE}-LIBRE`]), null);
    });

    console.log('2. Résolution d’un SKU (import mode stock)');
    await verifie('le SKU d’une variante résout produit + variante', async () => {
      const r = await resoudreSku(marchand.id, `${PREFIXE}-robe-bleu`.toLowerCase());
      assert.equal(r?.produit.id, robe.id);
      assert.equal(r?.variante?.id, bleu.id);
    });
    await verifie('le SKU du produit à variantes résout le produit seul', async () => {
      const r = await resoudreSku(marchand.id, `${PREFIXE}-ROBE`);
      assert.equal(r?.produit.id, robe.id);
      assert.equal(r?.variante, null);
    });

    console.log('3. Rattachement d’un colis');
    await verifie('produit à variantes sans variante : refusé', async () => {
      await rejette(() => verifierUniteStock(marchand.id, robe.id, null), /variante/);
    });
    await verifie('variante d’un autre produit : refusée', async () => {
      const autre = await prisma.produitVariante.findFirst({ where: { produitId: { not: robe.id } } });
      if (!autre) return;
      await rejette(() => verifierUniteStock(marchand.id, robe.id, autre.id), /varianteId invalide/);
    });
    await verifie('variante du produit : acceptée', async () => {
      const u = await verifierUniteStock(marchand.id, robe.id, rouge.id);
      assert.equal(u.varianteId, rouge.id);
    });

    console.log('4. Réservation au passage en préparation');
    const c1 = await creerColis({ produitId: robe.id, varianteId: rouge.id, quantite: 2 });
    const c2 = await creerColis({ produitId: robe.id, varianteId: rouge.id, quantite: 1 });
    await verifie('deux colis Rouge : 3 unités retirées de la variante Rouge', async () => {
      await prisma.$transaction((tx) => reserverStockColis(tx, [c1, c2], admin.id));
      const v = await prisma.produitVariante.findUniqueOrThrow({ where: { id: rouge.id } });
      assert.equal(v.quantiteRecue, 2);
      const c = await prisma.commande.findUniqueOrThrow({ where: { id: c1.id } });
      assert.ok(c.stockReserveLe);
    });
    await verifie('colis sans produit : refusé, rien décrémenté', async () => {
      const sans = await creerColis({ quantite: 1 });
      const avec = await creerColis({ produitId: robe.id, varianteId: bleu.id, quantite: 1 });
      await rejette(() => prisma.$transaction((tx) => reserverStockColis(tx, [sans, avec], admin.id)), /aucun produit/);
      const v = await prisma.produitVariante.findUniqueOrThrow({ where: { id: bleu.id } });
      assert.equal(v.quantiteRecue, 1);
    });
    await verifie('stock insuffisant sur une variante : refusé en tout ou rien', async () => {
      const a = await creerColis({ produitId: robe.id, varianteId: rouge.id, quantite: 1 });
      const b = await creerColis({ produitId: robe.id, varianteId: bleu.id, quantite: 9 });
      await rejette(() => prisma.$transaction((tx) => reserverStockColis(tx, [a, b], admin.id)), /insuffisant/);
      const v = await prisma.produitVariante.findUniqueOrThrow({ where: { id: rouge.id } });
      assert.equal(v.quantiteRecue, 2);
    });

    console.log('5. Réintégration');
    await verifie('le stock revient sur la variante, une seule fois', async () => {
      await prisma.$transaction((tx) => reintegrerStockColis(tx, c1.id, admin.id, 'audit'));
      const v = await prisma.produitVariante.findUniqueOrThrow({ where: { id: rouge.id } });
      assert.equal(v.quantiteRecue, 4);
      await rejette(
        () => prisma.$transaction((tx) => reintegrerStockColis(tx, c1.id, admin.id, null)),
        /déjà été réintégré/
      );
      const v2 = await prisma.produitVariante.findUniqueOrThrow({ where: { id: rouge.id } });
      assert.equal(v2.quantiteRecue, 4);
    });
  } finally {
    await prisma.commentaireCommande.deleteMany({ where: { commandeId: { in: colisIds } } });
    await prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: colisIds } } });
    await prisma.commande.deleteMany({ where: { id: { in: colisIds } } });
    await prisma.produit.delete({ where: { id: robe.id } });
  }

  console.log(`\n${reussis} réussi(s), ${echoues} échoué(s)`);
  if (echoues > 0) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
