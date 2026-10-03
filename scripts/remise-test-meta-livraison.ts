import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { nextBonEnvoiNumero, nextCodeSuivi } from '../lib/codes';
import { remettreBonEnvoiMeta } from '../lib/remise-meta-livraison';

/**
 * PREMIÈRE REMISE RÉELLE à Meta Livraison — `npx tsx scripts/remise-test-meta-livraison.ts --oui`
 *
 * ⚠️ CRÉE UN VRAI COLIS CHEZ META (aucune annulation par leur API). Le colis
 * est marqué « COLIS DE TEST — NE PAS LIVRER » dans le nom du destinataire,
 * l'adresse et la description, et porte un numéro fictif : c'est à nous de
 * leur demander de le supprimer.
 *
 * Écrit en base locale : un colis en transit et un bon d'envoi vers l'Agence
 * Fès, état exact que produit POST /api/bons-envoi (cf.
 * scripts/colis-test-prestataire.ts pour la raison d'un script). La remise
 * elle-même passe par `remettreBonEnvoiMeta`, le code du bouton.
 */

const AGENCE = 'Agence Fès';
const VILLE = 'Fès';
const MENTION = 'COLIS DE TEST — NE PAS LIVRER';

async function main(): Promise<void> {
  if (!process.argv.includes('--oui')) {
    console.log('À blanc : relancer avec --oui pour créer le colis chez Meta Livraison.');
    return;
  }
  const agence = await prisma.hub.findFirstOrThrow({ where: { nom: AGENCE, prestataire: { nom: 'Meta Livraison' } }, select: { id: true } });
  const marchand = await prisma.marchand.findFirstOrThrow({ select: { id: true }, orderBy: { dateCreation: 'asc' } });
  const admin = await prisma.utilisateur.findFirstOrThrow({ where: { role: 'admin' }, select: { id: true } });

  const bon = await prisma.$transaction(async (tx) => {
    const codeSuivi = await nextCodeSuivi();
    const numero = await nextBonEnvoiNumero(tx);
    const be = await tx.bonEnvoi.create({ data: { numero, hubDestinationId: agence.id, nbColis: 1 } });
    const colis = await tx.commande.create({
      data: {
        codeSuivi,
        marchandId: marchand.id,
        clientNom: `${MENTION} (Test API)`,
        clientTelephone: '0600000000',
        ville: VILLE,
        adresse: `${MENTION} — test d'intégration API, à supprimer`,
        produitDescription: 'Test API',
        montantCod: 1,
        fragile: true,
        statut: 'en_transit',
        bonEnvoiId: be.id,
        notes: `Colis de test créé par scripts/remise-test-meta-livraison.ts pour la première remise API Meta.`,
      },
      select: { id: true, codeSuivi: true },
    });
    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: colis.id,
        ancienStatut: null,
        nouveauStatut: 'en_transit',
        utilisateurId: admin.id,
        hubId: agence.id,
        note: `Colis de test intégré au BE ${numero} vers ${AGENCE} — première remise API Meta Livraison.`,
      },
    });
    console.log(`Colis ${colis.codeSuivi} · BE ${numero}`);
    return be;
  });

  const resultat = await remettreBonEnvoiMeta(bon.id, admin.id);
  console.log(JSON.stringify(resultat, null, 2));

  const remise = await prisma.remisePrestataire.findFirst({
    where: { bonEnvoiId: bon.id },
    select: { etat: true, codeEnvoye: true, codeExterne: true, erreur: true, reponseCreation: true },
  });
  console.log('Remise en base :', JSON.stringify(remise, null, 2));
}

main()
  .catch((erreur) => {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
