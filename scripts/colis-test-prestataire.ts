import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { nextCodeSuivi } from '../lib/codes';

/**
 * Crée un colis de test DÉJÀ ARRIVÉ à une agence d'un transporteur
 * sous-traitant, pour éprouver l'API de suivi (§ API_SUIVI_PRESTATAIRES.md).
 *
 *   npx tsx scripts/colis-test-prestataire.ts
 *   npx tsx scripts/colis-test-prestataire.ts "Meta Livraison" "Agence Taza"
 *
 * ÉCRIT EN BASE. À n'utiliser que sur un environnement de test.
 *
 * Pourquoi un script et pas le circuit normal : le seul chemin qui rattache un
 * colis à une agence sous-traitée est le bon d'envoi, et il exige d'abord un
 * marchand, un bon de livraison, un ramassage, un scan de réception, puis la
 * réception du BE à l'arrivée. Six gestes pour obtenir un état qu'on veut
 * seulement comme POINT DE DÉPART d'un test d'API.
 *
 * Le colis est posé à `recu_au_hub` avec `hubActuelId` sur l'agence : c'est
 * exactement l'état que produirait POST /api/bons-envoi/[id]/marquer-recu, et
 * c'est le seul qui rende le colis déclarable — le périmètre de l'API est
 * `commande.hubActuel.prestataireId` (§ lib/livraison-statut.ts), rien d'autre.
 *
 * Aucun statut d'issue n'est posé : livré / refusé / reporté sont précisément
 * ce que le transporteur viendra déclarer par l'API.
 */

const nomPrestataire = process.argv[2] ?? 'Meta';
const nomAgence = process.argv[3] ?? null;

async function main(): Promise<void> {
  const prestataire = await prisma.prestataire.findFirst({
    where: { nom: { contains: nomPrestataire, mode: 'insensitive' } },
    select: { id: true, nom: true },
  });
  if (!prestataire) {
    throw new Error(`Aucun transporteur ne correspond à « ${nomPrestataire} ».`);
  }

  const agence = await prisma.hub.findFirst({
    where: {
      prestataireId: prestataire.id,
      ...(nomAgence ? { nom: { contains: nomAgence, mode: 'insensitive' } } : {}),
    },
    select: { id: true, nom: true, ville: true },
    orderBy: { nom: 'asc' },
  });
  if (!agence) {
    throw new Error(`Aucune agence ${nomAgence ? `« ${nomAgence} » ` : ''}chez ${prestataire.nom}.`);
  }

  const marchand = await prisma.marchand.findFirst({
    select: { id: true, nomBoutique: true },
    orderBy: { dateCreation: 'asc' },
  });
  if (!marchand) {
    throw new Error('Aucun marchand en base — lancer `npm run db:seed` puis créer un marchand.');
  }

  // L'historique exige un auteur : on impute la création à un compte admin,
  // c'est la vérité (personne d'autre n'a posé ce colis là où il est).
  const admin = await prisma.utilisateur.findFirst({
    where: { role: 'admin' },
    select: { id: true, nomComplet: true },
  });
  if (!admin) {
    throw new Error('Aucun compte admin en base — lancer `npm run db:seed`.');
  }

  // La ville reste celle de l'agence : un colis posé à Taza mais adressé à
  // Agadir serait un état incohérent, et le premier écran qui recalculerait
  // son routage le renverrait ailleurs.
  const codeSuivi = await nextCodeSuivi();
  const maintenant = new Date();

  const colis = await prisma.$transaction(async (tx) => {
    const cree = await tx.commande.create({
      data: {
        codeSuivi,
        marchandId: marchand.id,
        clientNom: 'Client Test Prestataire',
        clientTelephone: '0600000000',
        ville: agence.ville,
        adresse: `Adresse de test — ${agence.ville}`,
        produitDescription: `Colis de test API suivi ${prestataire.nom}`,
        montantCod: 250,
        statut: 'recu_au_hub',
        hubActuelId: agence.id,
        dateReceptionHub: maintenant,
        notes: `Créé par scripts/colis-test-prestataire.ts pour tester POST /api/v1/livraisons/statut.`,
      },
      select: { id: true, codeSuivi: true, statut: true, ville: true, montantCod: true },
    });

    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: cree.id,
        ancienStatut: null,
        nouveauStatut: 'recu_au_hub',
        utilisateurId: admin.id,
        hubId: agence.id,
        note: `Colis de test posé directement à ${agence.nom} (${prestataire.nom}) pour l'API de suivi — hors circuit bon d'envoi.`,
      },
    });

    return cree;
  });

  console.log('Colis de test créé\n');
  console.log(`  code suivi   : ${colis.codeSuivi}`);
  console.log(`  statut       : ${colis.statut}  (aucune issue posée)`);
  console.log(`  transporteur : ${prestataire.nom}`);
  console.log(`  agence       : ${agence.nom}`);
  console.log(`  ville        : ${colis.ville}`);
  console.log(`  marchand     : ${marchand.nomBoutique}`);
  console.log(`  montant COD  : ${Number(colis.montantCod).toFixed(2)} DH`);

  // Sans clé portant le bon scope, l'API répondra 401 et le test échouera pour
  // une raison qui n'a rien à voir avec le colis : autant le dire tout de suite.
  const comptes = await prisma.plateformePartenaire.findMany({
    where: { prestataireId: prestataire.id },
    select: {
      code: true,
      nom: true,
      actif: true,
      cles: { where: { revoqueeLe: null }, select: { prefixe: true, environnement: true, scopes: true } },
    },
  });

  console.log('\nComptes machine de ce transporteur :');
  if (comptes.length === 0) {
    console.log('  AUCUN — /admin/integrations, « Nouvelle plateforme », choisir ce transporteur.');
  }
  for (const compte of comptes) {
    const utilisables = compte.cles.filter((c) => c.scopes.includes('livraisons:statut'));
    console.log(`  ${compte.nom} (« ${compte.code} »${compte.actif ? '' : ', DÉSACTIVÉ'})`);
    if (utilisables.length === 0) {
      console.log('    aucune clé active avec le scope « livraisons:statut »');
    }
    for (const cle of utilisables) {
      console.log(`    clé ${cle.environnement} — ${cle.prefixe.slice(0, 12)}…`);
    }
  }
}

main()
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
