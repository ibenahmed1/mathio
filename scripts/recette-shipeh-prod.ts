import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { prisma } from '../lib/prisma';
import type { ContextePlateforme } from '../lib/plateforme-auth';
import { analyserEntreeMarchand, synchroniserMarchand } from '../lib/plateforme-marchands';
import { analyserEntreeProduit, declarerProduit } from '../lib/plateforme-produits';
import { analyserEntreeColis, chargerReferentielVilles, ingererColis } from '../lib/plateforme-colis';
import { receptionnerUnite } from '../lib/stock-reception';

/**
 * Jeu de RECETTE Shipeh pour la production — une boutique, trois produits de
 * stock avec leurs photos, et six colis, déposés EXACTEMENT comme Shipeh les
 * déposerait : mêmes fonctions que l'API /v1 (synchronisation du marchand,
 * déclaration des produits, ingestion des colis), environnement `live`,
 * signés par le compte technique de la plateforme. Seule la réception du
 * stock est faite ici, au nom d'un admin, pour que les colis soient acceptés
 * (un colis Shipeh dont le produit n'est pas reçu est refusé).
 *
 *   npx tsx scripts/recette-shipeh-prod.ts                       (à blanc : vérifie, n'écrit rien)
 *   npx tsx scripts/recette-shipeh-prod.ts --oui                 (crée le jeu)
 *   npx tsx scripts/recette-shipeh-prod.ts --oui --lot=2         (six nouveaux colis, même boutique)
 *   npx tsx scripts/recette-shipeh-prod.ts --oui --admin=x@y.ma  (admin qui signe la réception)
 *
 * Rejouable : la boutique, les produits et les colis d'un lot déjà créés sont
 * retrouvés, jamais dupliqués. Le mot de passe de la boutique n'est affiché
 * qu'à la première exécution.
 *
 * Note pour le responsable du déploiement : RECETTE_SHIPEH_PROD.md.
 */

const args = process.argv.slice(2);
const APPLIQUER = args.includes('--oui');
const option = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.split('=').slice(1).join('=');
const LOT = Math.max(1, Math.trunc(Number(option('lot') ?? 1)) || 1);
const EMAIL_ADMIN = option('admin');

const ID_EXTERNE = 'RECETTE-SHIPEH-1';
const EMAIL_BOUTIQUE = 'recette.shipeh@mathio.test';
const TELEPHONE_BOUTIQUE = '0600000901';

// Image PNG unie traversée d'une bande blanche, en data URL : l'API Shipeh
// exige une photo par produit et par variante (doc v2.3).
function photo(r: number, g: number, b: number): string {
  const w = 96;
  const h = 96;
  const lignes = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bande = y > 36 && y < 60;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      lignes[o] = bande ? 255 : r;
      lignes[o + 1] = bande ? 255 : g;
      lignes[o + 2] = bande ? 255 : b;
    }
  }
  const bloc = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const taille = Buffer.alloc(4);
    taille.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([taille, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(lignes)),
    bloc('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const PRODUITS = [
  {
    idExterneMarchand: ID_EXTERNE,
    nom: 'Sérum Recette',
    reference: 'RECETTE-SERUM',
    note: 'Flacon 30 ml — jeu de recette',
    photoUrl: photo(214, 120, 160),
    quantiteEnCours: 40,
  },
  {
    idExterneMarchand: ID_EXTERNE,
    nom: 'Crème Recette',
    reference: 'RECETTE-CREME',
    note: 'Pot 50 ml — jeu de recette',
    photoUrl: photo(46, 139, 87),
    quantiteEnCours: 40,
  },
  {
    idExterneMarchand: ID_EXTERNE,
    nom: 'T-shirt Recette',
    reference: 'RECETTE-TSHIRT',
    photoUrl: photo(60, 60, 60),
    variantesActivees: true,
    variantes: [
      { nom: 'Noir / M', reference: 'RECETTE-TSHIRT-NOIR-M', quantiteEnCours: 20, photoUrl: photo(20, 20, 20) },
      { nom: 'Blanc / L', reference: 'RECETTE-TSHIRT-BLANC-L', quantiteEnCours: 20, photoUrl: photo(200, 200, 210) },
    ],
  },
];

// Une ville par grand transporteur du référentiel du 10/10.
const COLIS = [
  { ville: 'Casablanca', cod: 150, produits: [{ sku: 'RECETTE-SERUM', quantite: 1 }] },
  { ville: 'Rabat', cod: 200, produits: [{ sku: 'RECETTE-CREME', quantite: 2 }] },
  { ville: 'Marrakech', cod: 250, produits: [{ sku: 'RECETTE-TSHIRT-NOIR-M', quantite: 1 }] },
  { ville: 'Tanger', cod: 300, produits: [{ sku: 'RECETTE-SERUM', quantite: 1 }, { sku: 'RECETTE-CREME', quantite: 1 }] },
  { ville: 'Fès', cod: 350, produits: [{ sku: 'RECETTE-TSHIRT-BLANC-L', quantite: 2 }] },
  { ville: 'Agadir', cod: 400, produits: [{ sku: 'RECETTE-CREME', quantite: 1 }, { sku: 'RECETTE-TSHIRT-NOIR-M', quantite: 1 }] },
];

class Blocage extends Error {}

async function main() {
  console.log(APPLIQUER ? '== Recette Shipeh : CRÉATION ==' : '== Recette Shipeh : À BLANC (rien n’est écrit) ==');

  // --- Prérequis ------------------------------------------------------------
  const shipeh = await prisma.plateformePartenaire.findFirst({
    where: { code: 'shipeh' },
    select: { id: true, code: true, actif: true, utilisateurTechniqueId: true, prestataireId: true },
  });
  if (!shipeh) throw new Blocage('Plateforme « shipeh » introuvable : la créer dans Admin → Intégrations avant la recette.');
  if (!shipeh.actif) throw new Blocage('La plateforme Shipeh est désactivée.');
  if (shipeh.prestataireId) throw new Blocage('La plateforme « shipeh » est rattachée à un transporteur : ce n’est pas un canal de vente.');

  const admin = await prisma.utilisateur.findFirst({
    where: { role: 'admin', actif: true, email: EMAIL_ADMIN ? EMAIL_ADMIN.toLowerCase() : { not: null } },
    orderBy: { dateCreation: 'asc' },
    select: { id: true, nomComplet: true, email: true },
  });
  if (!admin) throw new Blocage(EMAIL_ADMIN ? `Aucun admin actif avec l’email ${EMAIL_ADMIN}.` : 'Aucun compte admin actif.');
  console.log(`Réception du stock signée par : ${admin.nomComplet} (${admin.email ?? 'sans email'})`);

  const villes = await chargerReferentielVilles();
  const absentes = COLIS.filter((c) => !villes.pour(c.ville)).map((c) => c.ville);
  if (absentes.length > 0) throw new Blocage(`Villes absentes du référentiel : ${absentes.join(', ')}.`);
  console.log(`Villes des colis : toutes trouvées (${COLIS.map((c) => c.ville).join(', ')}).`);

  const lien = await prisma.compteMarchandExterne.findFirst({
    where: { plateformeId: shipeh.id, environnement: 'live', idExterne: ID_EXTERNE },
    select: { marchand: { select: { nomBoutique: true } } },
  });
  console.log(lien ? `Boutique déjà créée : ${lien.marchand.nomBoutique}.` : 'Boutique : à créer.');
  // Sans lien, un compte portant déjà cet email ou ce téléphone serait
  // RATTACHÉ à Shipeh par la synchronisation : un vrai compte deviendrait une
  // boutique de plateforme. On s'arrête plutôt.
  if (!lien) {
    const homonyme = await prisma.utilisateur.findFirst({
      where: { OR: [{ email: EMAIL_BOUTIQUE }, { telephone: TELEPHONE_BOUTIQUE }] },
      select: { nomComplet: true },
    });
    if (homonyme) {
      throw new Blocage(`Le compte « ${homonyme.nomComplet} » porte déjà ${EMAIL_BOUTIQUE} ou ${TELEPHONE_BOUTIQUE} : il serait rattaché à Shipeh.`);
    }
  }

  if (!APPLIQUER) {
    console.log('\nTout est prêt. Relancer avec --oui pour créer le jeu de recette.');
    return;
  }

  // Ce que requirePlateforme construirait pour une clé live de Shipeh. Aucune
  // clé n'est émise : les fonctions de l'API ne lisent pas cleId.
  const contexte: ContextePlateforme = {
    plateformeId: shipeh.id,
    plateformeCode: shipeh.code,
    cleId: 'script-recette',
    scopes: ['marchands:creation_validee', 'produits:creation', 'colis:creation'],
    environnement: 'live',
    utilisateurTechniqueId: shipeh.utilisateurTechniqueId,
    depreciationLe: null,
    adresseIp: null,
  };

  // --- 1. Boutique ------------------------------------------------------------
  const motDePasse = `Recette-${randomBytes(6).toString('base64url')}`;
  const boutique = await synchroniserMarchand(
    contexte,
    analyserEntreeMarchand({
      idExterne: ID_EXTERNE,
      nomComplet: 'Recette Shipeh',
      nomBoutique: 'Boutique Recette Shipeh',
      telephone: TELEPHONE_BOUTIQUE,
      email: EMAIL_BOUTIQUE,
      motDePasse,
      ville: 'Casablanca',
    }),
    { activer: true }
  );
  console.log(`\n1. Boutique : ${boutique.issue} (${boutique.marchandId})`);

  // --- 2. Produits ------------------------------------------------------------
  for (const p of PRODUITS) {
    const r = await declarerProduit(contexte, analyserEntreeProduit(p));
    console.log(`2. Produit ${p.reference} : ${r.issue}`);
  }

  // --- 3. Réception au stock (geste de l'entrepôt) ------------------------------
  const aRecevoir = await prisma.produit.findMany({
    where: { marchandId: boutique.marchandId, reference: { in: PRODUITS.map((p) => p.reference) }, statutReception: 'pas_encore_recu' },
    include: { variantes: true },
  });
  for (const p of aRecevoir) {
    await prisma.$transaction(async (tx) => {
      await tx.produit.update({ where: { id: p.id }, data: { statutReception: 'recu' } });
      await tx.historiqueProduit.create({
        data: { produitId: p.id, texte: 'Statut de réception : Pas encore reçu → Reçu (jeu de recette)', utilisateurId: admin.id },
      });
      if (p.variantesActivees) {
        for (const v of p.variantes.filter((v) => v.quantiteEnCours > 0)) {
          await receptionnerUnite(tx, { produitId: p.id, varianteId: v.id, nom: `${p.nom} — ${v.nom}`, quantite: v.quantiteEnCours, utilisateurId: admin.id });
        }
      } else if (p.quantiteEnCours > 0) {
        await receptionnerUnite(tx, { produitId: p.id, varianteId: null, nom: p.nom, quantite: p.quantiteEnCours, utilisateurId: admin.id });
      }
    });
    console.log(`3. Stock reçu : ${p.reference}`);
  }
  if (aRecevoir.length === 0) console.log('3. Stock : déjà reçu.');

  // --- 4. Colis -----------------------------------------------------------------
  const codes: string[] = [];
  for (const [i, c] of COLIS.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const r = await ingererColis(
      contexte,
      analyserEntreeColis({
        idExterneMarchand: ID_EXTERNE,
        reference: `RECETTE-L${LOT}-${n}`,
        clientNom: `Client Recette ${LOT}-${n}`,
        clientTelephone: `0600000${LOT % 10}${n}`,
        ville: c.ville,
        adresse: `${i + 1} rue de la Recette`,
        montantCod: c.cod,
        produits: c.produits,
        notes: 'COLIS DE RECETTE — ne pas expédier',
      }),
      villes
    );
    codes.push(`${r.codeSuivi ?? '?'}  ${c.ville.padEnd(10)} ${String(c.cod).padStart(4)} DH  (${r.issue})`);
  }
  console.log(`4. Colis du lot ${LOT} :\n   ${codes.join('\n   ')}`);

  console.log('\n== Jeu de recette prêt ==');
  console.log(`Boutique : Boutique Recette Shipeh — connexion ${EMAIL_BOUTIQUE}`);
  console.log(
    boutique.motDePasseDefini
      ? `Mot de passe : ${motDePasse}   (affiché UNE seule fois, à transmettre au testeur)`
      : 'Mot de passe : inchangé (affiché à la première exécution).'
  );
  console.log('Suite : RECETTE_SHIPEH_PROD.md, à partir de « Stock → Nouveaux ».');
}

main()
  .catch((e) => {
    console.error(e instanceof Blocage ? `ARRÊT : ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
