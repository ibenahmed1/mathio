import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { nextCodeSuivi } from '../lib/codes';
import { chargerReferentielRoutage } from '../lib/hub-envoi';

/**
 * Crée des colis de test « nouveau colis » pour un marchand, comme le ferait
 * POST /api/commandes (code de suivi, ville rattachée au routage, historique).
 *
 *   npx tsx scripts/colis-test-marchand.ts
 *   npx tsx scripts/colis-test-marchand.ts "Boutique Démo" 8
 *
 * ÉCRIT EN BASE. À n'utiliser que sur un environnement de test.
 */

const nomBoutique = process.argv[2] ?? 'Boutique Démo';
const nombre = Number(process.argv[3] ?? 6);

const VILLES = ['Casablanca', 'Rabat', 'Marrakech', 'Tanger', 'Fès', 'Agadir', 'Meknès', 'Oujda'];
const PRENOMS = ['Yassine', 'Salma', 'Omar', 'Khadija', 'Mehdi', 'Imane', 'Hamza', 'Nadia'];
const PRODUITS = ['Montre connectée', 'Sac à main cuir', 'Écouteurs sans fil', 'Crème hydratante', 'Chaussures sport', 'Coque téléphone'];

async function main(): Promise<void> {
  const marchand = await prisma.marchand.findFirst({
    where: { nomBoutique: { equals: nomBoutique, mode: 'insensitive' } },
    select: { id: true, nomBoutique: true, utilisateurId: true },
  });
  if (!marchand) throw new Error(`Aucun marchand « ${nomBoutique} ».`);

  const referentiel = await chargerReferentielRoutage();
  const horodatage = Date.now().toString().slice(-6);

  console.log(`Colis créés pour ${marchand.nomBoutique} :\n`);
  for (let i = 0; i < nombre; i++) {
    const ville = VILLES[i % VILLES.length];
    const codeSuivi = await nextCodeSuivi();
    const colis = await prisma.$transaction(async (tx) => {
      const cree = await tx.commande.create({
        data: {
          codeSuivi,
          marchandId: marchand.id,
          clientNom: `${PRENOMS[i % PRENOMS.length]} Test ${horodatage}`,
          clientTelephone: `06${String(10000000 + Math.floor(Math.random() * 89999999))}`,
          ville,
          adresse: `${10 + i} rue de test, ${ville}`,
          produitDescription: PRODUITS[i % PRODUITS.length],
          montantCod: 150 + i * 50,
          statut: 'nouveau_colis',
          source: 'manuel',
          villeId: referentiel.pour(ville)?.id ?? null,
          notes: 'Colis de test (scripts/colis-test-marchand.ts)',
        },
        select: { id: true, codeSuivi: true, ville: true, villeId: true, montantCod: true, clientNom: true },
      });
      await tx.historiqueStatutCommande.create({
        data: { commandeId: cree.id, ancienStatut: null, nouveauStatut: 'nouveau_colis', utilisateurId: marchand.utilisateurId },
      });
      return cree;
    });
    console.log(`  ${colis.codeSuivi}  ${colis.ville.padEnd(11)} ${String(Number(colis.montantCod)).padStart(4)} DH  ${colis.clientNom}${colis.villeId ? '' : '  (ville non rattachée)'}`);
  }
}

main()
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
