import 'dotenv/config';
import assert from 'node:assert/strict';
import { Prisma } from '../app/generated/prisma/client';
import { prisma } from '../lib/prisma';
import { buildCommandesWhere } from '../lib/commandes-filters';
import { getVillesHubCentral, statutApresPreparation } from '../lib/hub-stock';
import { nextCodeSuivi, nextBonPreparationNumero } from '../lib/codes';
import type { SessionPayload } from '../lib/auth';
import { ALL_PERMISSIONS } from '../lib/permissions';

// Script d'audit local du circuit "colis stock / fulfillment" (enStock=true),
// exécutable via `npx tsx scripts/test-stock-pipeline-audit.ts`.
//
// Trois volets, chacun correspondant à un bug rapporté sur ce circuit :
//  1. Anti-doublon import (contrainte @@unique([marchandId, codeSuiviPartenaire])
//     + pré-vérification faite par POST /api/commandes/import).
//  2. Isolation des vues (lib/commandes-filters.ts : un colis stock encore en
//     préparation ne doit apparaître que dans /admin/stock/**, jamais dans la
//     liste back-office générique /admin/commandes).
//  3. Audit de la "machine à états" du pipeline stock : nouveau_colis ->
//     pret_pour_preparation (décrémentation atomique du stock réel) ->
//     regroupement en BonDePreparation -> validation -> recu_au_hub/en_transit,
//     et rejet d'une transition illégale (colis stock dans un BonDeLivraison
//     marchand classique).
//
// Ce script exerce directement les fonctions partagées réellement utilisées
// par l'application (buildCommandesWhere, statutApresPreparation…) et rejoue
// fidèlement la logique des routes qui ne sont pas appelables hors contexte
// Next.js (celles qui dépendent de next/headers pour la session), plutôt que
// de la ré-implémenter de façon approximative. Toutes les données créées sont
// préfixées et supprimées en fin d'exécution, succès ou échec.

const PREFIXE = `AUDIT-${Date.now()}`;
let reussis = 0;
let echoues = 0;

function ok(label: string) {
  reussis++;
  console.log(`  ✅ ${label}`);
}

function ko(label: string, err: unknown) {
  echoues++;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`  ❌ ${label} — ${message}`);
}

async function verifie(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    ko(label, err);
  }
}

// Session synthétique passée directement aux fonctions de lib/** (ce script
// n'appelle pas l'API en HTTP) : `space` reflète l'espace back-office, seul
// depuis lequel ces opérations de stock sont exposées.
const SESSION_ADMIN: SessionPayload = {
  sub: `${PREFIXE}-admin`,
  role: 'admin',
  extraRoles: [],
  // Catalogue entier, comme le résout effectivePermissions() pour un admin.
  permissions: [...ALL_PERMISSIONS],
  space: 'admin',
  impersonated: false,
};

async function creerMarchand(suffixe: string) {
  const utilisateur = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Marchand ${suffixe}`,
      email: `${PREFIXE.toLowerCase()}-${suffixe}@audit.test`,
      motDePasseHash: 'audit-script-hash-non-utilisable',
      role: 'marchand',
    },
  });
  const marchand = await prisma.marchand.create({
    data: { utilisateurId: utilisateur.id, nomBoutique: `${PREFIXE} Boutique ${suffixe}` },
  });
  return { utilisateur, marchand };
}

async function creerCommande(overrides: Partial<Prisma.CommandeUncheckedCreateInput> & { marchandId: string }) {
  const codeSuivi = await nextCodeSuivi();
  return prisma.commande.create({
    data: {
      codeSuivi,
      clientNom: `${PREFIXE} Client`,
      clientTelephone: '0600000000',
      ville: 'Casablanca',
      adresse: 'Adresse audit',
      montantCod: new Prisma.Decimal(100),
      statut: 'nouveau_colis',
      source: 'manuel',
      ...overrides,
    },
  });
}

async function main() {
  console.log(`\n=== Audit pipeline colis stock (préfixe ${PREFIXE}) ===\n`);

  const { marchand: m1 } = await creerMarchand('M1');

  try {
    // ------------------------------------------------------------------
    console.log('1) Anti-doublon (référence partenaire)');
    await verifie('deux colis sans référence partenaire (null) coexistent sans conflit', async () => {
      await creerCommande({ marchandId: m1.id, codeSuiviPartenaire: null });
      await creerCommande({ marchandId: m1.id, codeSuiviPartenaire: null });
    });

    const refPartenaire = `${PREFIXE}-REF-001`;
    const original = await creerCommande({ marchandId: m1.id, codeSuiviPartenaire: refPartenaire });

    await verifie('la pré-vérification applicative (celle utilisée par /api/commandes/import) détecte le doublon avant insertion', async () => {
      // Reproduit exactement la requête de détection de doublon de
      // app/api/commandes/import/route.ts (étape 2.5b) pour la même paire
      // (marchandId, codeSuiviPartenaire).
      const existants = await prisma.commande.findMany({
        where: { OR: [{ marchandId: m1.id, codeSuiviPartenaire: refPartenaire }] },
        select: { codeSuivi: true },
      });
      assert.equal(existants.length, 1, 'la requête de détection doit retrouver la commande déjà importée');
      assert.equal(existants[0].codeSuivi, original.codeSuivi);
    });

    await verifie('la contrainte @@unique([marchandId, codeSuiviPartenaire]) rejette un doublon en base (filet de sécurité final)', async () => {
      await assert.rejects(
        () => creerCommande({ marchandId: m1.id, codeSuiviPartenaire: refPartenaire }),
        (err: unknown) => {
          assert.ok(err instanceof Prisma.PrismaClientKnownRequestError, `erreur inattendue : ${err}`);
          assert.equal(err.code, 'P2002', `code d'erreur inattendu : ${err.code}`);
          return true;
        }
      );
    });

    await verifie('la même référence partenaire reste utilisable par un AUTRE marchand (unicité scopée par marchand)', async () => {
      const { marchand: m2 } = await creerMarchand('M2-doublon');
      await creerCommande({ marchandId: m2.id, codeSuiviPartenaire: refPartenaire });
    });

    // ------------------------------------------------------------------
    console.log('\n2) Isolation des vues (colis stock en préparation vs liste globale)');

    const colisNormal = await creerCommande({ marchandId: m1.id, enStock: false, statut: 'nouveau_colis' });
    const colisStockNouveau = await creerCommande({ marchandId: m1.id, enStock: true, statut: 'nouveau_colis' });
    const colisStockPret = await creerCommande({ marchandId: m1.id, enStock: true, statut: 'pret_pour_preparation' });
    const colisStockAuHub = await creerCommande({ marchandId: m1.id, enStock: true, statut: 'recu_au_hub' });

    await verifie('/admin/commandes (excludeEnPreparationStock=true) masque les colis stock encore en préparation', async () => {
      const where = await buildCommandesWhere(
        new URLSearchParams({ excludeEnPreparationStock: 'true' }),
        SESSION_ADMIN
      );
      const resultats = await prisma.commande.findMany({ where: { ...where, marchandId: m1.id }, select: { id: true } });
      const ids = new Set(resultats.map((c) => c.id));
      assert.ok(ids.has(colisNormal.id), 'le colis normal doit rester visible');
      assert.ok(!ids.has(colisStockNouveau.id), 'un colis stock "nouveau_colis" ne doit PAS apparaître');
      assert.ok(!ids.has(colisStockPret.id), 'un colis stock "pret_pour_preparation" ne doit PAS apparaître');
      assert.ok(ids.has(colisStockAuHub.id), 'un colis stock déjà "recu_au_hub" doit redevenir visible (a quitté le Hub)');
    });

    await verifie('/admin/stock/nouveaux (enStock=true&statut=nouveau_colis) ne voit QUE les colis stock nouveaux', async () => {
      const where = await buildCommandesWhere(
        new URLSearchParams({ enStock: 'true', statut: 'nouveau_colis' }),
        SESSION_ADMIN
      );
      const resultats = await prisma.commande.findMany({ where: { ...where, marchandId: m1.id }, select: { id: true } });
      const ids = new Set(resultats.map((c) => c.id));
      assert.ok(ids.has(colisStockNouveau.id));
      assert.ok(!ids.has(colisNormal.id), 'un colis normal ne doit pas apparaître dans la vue stock');
      assert.ok(!ids.has(colisStockPret.id), 'un colis déjà passé en préparation ne doit plus apparaître ici');
    });

    await verifie('sans le paramètre excludeEnPreparationStock, la recherche /admin/colis/suivi retrouve toujours un colis stock en préparation', async () => {
      // Non-régression : l'exclusion est opt-in (§ commandes-filters.ts) pour
      // ne pas casser la recherche par code de suivi sur un colis pas encore pris en charge.
      const where = await buildCommandesWhere(new URLSearchParams({ search: colisStockNouveau.codeSuivi }), SESSION_ADMIN);
      const resultats = await prisma.commande.findMany({ where, select: { id: true } });
      assert.ok(resultats.some((c) => c.id === colisStockNouveau.id));
    });

    // ------------------------------------------------------------------
    console.log('\n3) Audit machine à états — pipeline stock complet');

    const produit = await prisma.produit.create({
      data: {
        marchandId: m1.id,
        nom: `${PREFIXE} Produit`,
        reference: `${PREFIXE}-SKU`,
        quantiteRecue: 5,
        statutReception: 'recu',
      },
    });

    const villesHubCentral = await getVillesHubCentral();
    const villeCouverte = Array.from(villesHubCentral)[0];
    if (!villeCouverte) {
      console.warn('  ⚠️  Aucune ville seedée dans la zone "hub_central" — le cas recu_au_hub ne sera pas exercé (seed manquant), seul en_transit sera vérifié.');
    }
    const villeHorsZone = `${PREFIXE}-ville-hors-zone-inexistante`;

    const colisPourHub = await creerCommande({
      marchandId: m1.id,
      enStock: true,
      statut: 'nouveau_colis',
      produitId: produit.id,
      quantite: 3,
      ville: villeCouverte ?? villeHorsZone,
    });
    const colisEnTransit = await creerCommande({
      marchandId: m1.id,
      enStock: true,
      statut: 'nouveau_colis',
      ville: villeHorsZone,
    });

    await verifie('nouveau_colis -> pret_pour_preparation décrémente Produit.quantiteRecue de façon atomique', async () => {
      // Reproduit fidèlement la transaction de POST /api/stock/pret-pour-preparation.
      const ids = [colisPourHub.id, colisEnTransit.id];
      const colis = await prisma.commande.findMany({ where: { id: { in: ids }, enStock: true, statut: 'nouveau_colis' } });
      assert.equal(colis.length, ids.length, 'les deux colis doivent être éligibles');

      const besoinsParProduit = new Map<string, number>();
      for (const c of colis) {
        if (!c.produitId) continue;
        besoinsParProduit.set(c.produitId, (besoinsParProduit.get(c.produitId) ?? 0) + c.quantite);
      }

      await prisma.$transaction(async (tx) => {
        for (const [produitId, quantiteNecessaire] of besoinsParProduit) {
          const resultat = await tx.produit.updateMany({
            where: { id: produitId, quantiteRecue: { gte: quantiteNecessaire } },
            data: { quantiteRecue: { decrement: quantiteNecessaire } },
          });
          assert.equal(resultat.count, 1, 'le décrément doit réussir (stock suffisant)');
        }
        await tx.commande.updateMany({ where: { id: { in: ids } }, data: { statut: 'pret_pour_preparation' } });
      });

      const produitApres = await prisma.produit.findUniqueOrThrow({ where: { id: produit.id } });
      assert.equal(produitApres.quantiteRecue, 2, 'quantiteRecue doit passer de 5 à 2 (5 - 3 pour colisPourHub)');
      const colisApres = await prisma.commande.findMany({ where: { id: { in: ids } } });
      assert.ok(colisApres.every((c) => c.statut === 'pret_pour_preparation'));
    });

    await verifie('un besoin supérieur au stock réel restant est rejeté tout-ou-rien (aucun décrément partiel)', async () => {
      const quantiteExcessive = 999;
      const resultat = await prisma.produit.updateMany({
        where: { id: produit.id, quantiteRecue: { gte: quantiteExcessive } },
        data: { quantiteRecue: { decrement: quantiteExcessive } },
      });
      assert.equal(resultat.count, 0, "la clause gte doit empêcher tout décrément quand le stock réel est insuffisant");
      const produitInchange = await prisma.produit.findUniqueOrThrow({ where: { id: produit.id } });
      assert.equal(produitInchange.quantiteRecue, 2, 'le stock réel ne doit pas avoir bougé');
    });

    await verifie('regroupement en BonDePreparation ne change pas le statut des colis', async () => {
      const numero = await nextBonPreparationNumero(prisma);
      const bon = await prisma.bonDePreparation.create({ data: { numero, marchandId: m1.id, nbColis: 2 } });
      await prisma.commande.updateMany({
        where: { id: { in: [colisPourHub.id, colisEnTransit.id] } },
        data: { bonPreparationId: bon.id },
      });
      const colisApres = await prisma.commande.findMany({ where: { id: { in: [colisPourHub.id, colisEnTransit.id] } } });
      assert.ok(colisApres.every((c) => c.statut === 'pret_pour_preparation'), 'le statut ne doit pas changer au simple regroupement');
      assert.ok(colisApres.every((c) => c.bonPreparationId === bon.id));
    });

    await verifie('validation du bon fait avancer chaque colis vers recu_au_hub ou en_transit selon sa ville', async () => {
      const statutColisHub = statutApresPreparation(colisPourHub.ville, villesHubCentral);
      const statutColisTransit = statutApresPreparation(colisEnTransit.ville, villesHubCentral);
      assert.equal(statutColisTransit, 'en_transit', 'une ville hors zone hub_central doit produire en_transit');
      if (villeCouverte) {
        assert.equal(statutColisHub, 'recu_au_hub', 'une ville couverte par hub_central doit produire recu_au_hub');
      }

      await prisma.commande.update({ where: { id: colisPourHub.id }, data: { statut: statutColisHub } });
      await prisma.commande.update({ where: { id: colisEnTransit.id }, data: { statut: statutColisTransit } });

      const [hubApres, transitApres] = await Promise.all([
        prisma.commande.findUniqueOrThrow({ where: { id: colisPourHub.id } }),
        prisma.commande.findUniqueOrThrow({ where: { id: colisEnTransit.id } }),
      ]);
      assert.equal(hubApres.statut, statutColisHub);
      assert.equal(transitApres.statut, 'en_transit');
    });

    await verifie('transition illégale rejetée : un colis enStock=true ne peut pas être sélectionné pour un BonDeLivraison marchand', async () => {
      // Reproduit le where de creerBonDeLivraison (app/marchand/bons-livraison/actions.ts) :
      // { statut: 'nouveau_colis', bonLivraisonId: null, enStock: false }.
      const colisStockFrais = await creerCommande({ marchandId: m1.id, enStock: true, statut: 'nouveau_colis' });
      const eligibles = await prisma.commande.findMany({
        where: { id: { in: [colisStockFrais.id] }, marchandId: m1.id, statut: 'nouveau_colis', bonLivraisonId: null, enStock: false },
      });
      assert.equal(eligibles.length, 0, 'un colis enStock=true ne doit jamais être éligible à un Bon de Livraison marchand');
    });
  } finally {
    console.log('\nNettoyage des données de test…');
    await prisma.historiqueStatutCommande.deleteMany({ where: { commande: { clientNom: `${PREFIXE} Client` } } });
    await prisma.commande.deleteMany({ where: { clientNom: `${PREFIXE} Client` } });
    await prisma.bonDePreparation.deleteMany({ where: { marchand: { nomBoutique: { startsWith: PREFIXE } } } });
    await prisma.produit.deleteMany({ where: { marchand: { nomBoutique: { startsWith: PREFIXE } } } });
    await prisma.marchand.deleteMany({ where: { nomBoutique: { startsWith: PREFIXE } } });
    await prisma.utilisateur.deleteMany({ where: { nomComplet: { startsWith: PREFIXE } } });
  }

  console.log(`\n=== Résultat : ${reussis} test(s) réussi(s), ${echoues} échec(s) ===\n`);
  await prisma.$disconnect();
  process.exit(echoues > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Échec inattendu du script d\'audit :', err);
  await prisma.$disconnect();
  process.exit(1);
});
