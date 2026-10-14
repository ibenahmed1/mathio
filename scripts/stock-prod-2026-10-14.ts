import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { journaliserMouvements } from '../lib/stock-mouvements';
import { receptionnerUnite } from '../lib/stock-reception';
import { servirColisEnAttente } from '../lib/stock-reservation';

/**
 * Entrée en stock demandée le 14/10/2026 pour la PRODUCTION : deux produits
 * arrivés en entrepôt, à passer « Reçu » avec leurs quantités comptées.
 *
 *   npx tsx scripts/stock-prod-2026-10-14.ts                       (à blanc : affiche, n'écrit rien)
 *   npx tsx scripts/stock-prod-2026-10-14.ts --oui                 (écrit)
 *   npx tsx scripts/stock-prod-2026-10-14.ts --oui --admin=x@y.ma  (admin qui signe la réception)
 *
 * Par produit, dans UNE transaction, par les mêmes chemins que la fiche
 * produit : statut « Reçu », puis les unités passent en stock reçu
 * (historique, journal des mouvements, envois annoncés servis). Les unités
 * déjà déclarées « en cours » sont consommées d'abord ; seul le complément
 * est ajouté à l'annoncé avant d'être reçu — jamais de doublon d'annonce.
 *
 * Non rejouable : chaque produit porte une trace « [stock-prod-2026-10-14] »
 * dans son historique, et le script s'arrête s'il la trouve.
 */

const ENTREES = [
  { reference: 'VJ6558', quantite: 367 },
  { reference: 'GT7022', quantite: 488 },
];
const TRACE = '[stock-prod-2026-10-14]';

const args = process.argv.slice(2);
const APPLIQUER = args.includes('--oui');
const EMAIL_ADMIN = args.find((a) => a.startsWith('--admin='))?.slice('--admin='.length);

class Blocage extends Error {}

async function main() {
  const admin = await prisma.utilisateur.findFirst({
    where: { role: 'admin', actif: true, email: EMAIL_ADMIN ? EMAIL_ADMIN.toLowerCase() : { not: null } },
    select: { id: true, nomComplet: true, email: true },
    orderBy: { dateCreation: 'asc' },
  });
  if (!admin) throw new Blocage(EMAIL_ADMIN ? `Aucun admin actif avec l’email ${EMAIL_ADMIN}.` : 'Aucun compte admin actif.');
  console.log(`Réception signée par : ${admin.nomComplet} (${admin.email})\n`);

  // Tout est vérifié AVANT la moindre écriture : un produit introuvable ou
  // ambigu arrête le script sans rien toucher.
  const plan = [];
  for (const entree of ENTREES) {
    const trouves = await prisma.produit.findMany({
      where: { reference: entree.reference, OR: [{ environnementPlateforme: null }, { environnementPlateforme: 'live' }] },
      include: { marchand: { select: { nomBoutique: true } }, plateforme: { select: { nom: true } } },
    });
    if (trouves.length === 0) throw new Blocage(`${entree.reference} : aucun produit avec cette référence.`);
    if (trouves.length > 1) {
      throw new Blocage(
        `${entree.reference} : ${trouves.length} produits portent cette référence (${trouves.map((p) => p.marchand?.nomBoutique ?? `stock commun ${p.plateforme?.nom}`).join(', ')}). Préciser lequel.`
      );
    }
    const produit = trouves[0];
    if (produit.variantesActivees) {
      throw new Blocage(`${entree.reference} : produit à variantes, la quantité doit être répartie par variante.`);
    }
    if (await prisma.historiqueProduit.count({ where: { produitId: produit.id, texte: { contains: TRACE } } })) {
      throw new Blocage(`${entree.reference} : ce script a déjà été passé sur ce produit (trace ${TRACE}). Rien n’est refait.`);
    }
    const depuisDeclare = Math.min(produit.quantiteEnCours, entree.quantite);
    plan.push({ produit, quantite: entree.quantite, depuisDeclare, complement: entree.quantite - depuisDeclare });
    console.log(`${entree.reference} — ${produit.nom}`);
    console.log(`  stock de : ${produit.marchand?.nomBoutique ?? `stock commun ${produit.plateforme?.nom}`}`);
    console.log(`  statut ${produit.statutReception}, reçu ${produit.quantiteRecue}, déclaré en cours ${produit.quantiteEnCours}`);
    console.log(`  → +${entree.quantite} reçues (${depuisDeclare} prises sur le déclaré, ${entree.quantite - depuisDeclare} ajoutées), reçu final ${produit.quantiteRecue + entree.quantite}\n`);
  }

  if (!APPLIQUER) {
    console.log('À blanc : rien n’a été écrit. Relancer avec --oui pour appliquer.');
    return;
  }

  for (const { produit, quantite, depuisDeclare, complement } of plan) {
    await prisma.$transaction(async (tx) => {
      if (produit.statutReception !== 'recu') {
        await tx.produit.update({ where: { id: produit.id }, data: { statutReception: 'recu' } });
      }
      await tx.historiqueProduit.create({
        data: {
          produitId: produit.id,
          texte: `Entrée en stock de ${quantite} unité(s) comptées en entrepôt, statut « Reçu » ${TRACE}`,
          utilisateurId: admin.id,
        },
      });
      if (complement > 0) {
        await tx.produit.update({ where: { id: produit.id }, data: { quantiteEnCours: { increment: complement } } });
        await journaliserMouvements(tx, [
          { type: 'annonce', produitId: produit.id, quantite: complement, utilisateurId: admin.id, motif: `Complément compté en entrepôt ${TRACE}` },
        ]);
      }
      // Garde de receptionnerUnite : refuse si le déclaré a bougé depuis la lecture.
      await receptionnerUnite(tx, { produitId: produit.id, varianteId: null, nom: produit.nom, quantite, utilisateurId: admin.id });
    });
    const apres = await prisma.produit.findUniqueOrThrow({ where: { id: produit.id } });
    console.log(`${produit.reference} : fait — statut ${apres.statutReception}, reçu ${apres.quantiteRecue}, en cours ${apres.quantiteEnCours} (dont ${depuisDeclare} pris sur le déclaré)`);
  }

  // Du stock vient d'entrer : les colis de plateforme qui l'attendaient sont servis.
  const servis = await servirColisEnAttente(plan.map((p) => p.produit.id), admin.id);
  console.log(`Colis en attente de stock servis : ${servis}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Blocage ? `ARRÊT : ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
