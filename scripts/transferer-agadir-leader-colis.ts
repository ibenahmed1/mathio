import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Rend l'Agence Agadir à LEADER COLIS —
 *
 *   npx tsx scripts/transferer-agadir-leader-colis.ts            (applique)
 *   npx tsx scripts/transferer-agadir-leader-colis.ts --simuler  (n'écrit rien)
 *
 * CORRECTION D'ATTRIBUTION, décidée le 23 septembre 2026. Les 51 villes du
 * Souss rattachées à l'Agence Agadir avaient été importées sous « Sahario
 * Express » : c'est Leader Colis qui les sert. Sahario ne dessert que Guelmim.
 *
 * POURQUOI UN SCRIPT À PART, ET NON UNE ÉTAPE DE `db:reseau`
 *
 * `resoudreHubImport` (lib/prestataires.ts) REFUSE de reprendre un quai qui
 * appartient à un autre prestataire, et `detecterBlocages` arrête le
 * chargement avant sa première écriture pour la même raison : transférer une
 * agence déplace avec elle ses villes, ses tarifs et le coût de ses colis —
 * c'est une décision, pas un effet de bord d'import. Ces deux garde-fous
 * restent intacts ; ce script est le geste explicite qu'ils réclament, à passer
 * UNE FOIS sur chaque base déjà chargée, comme `restituer-lignes-sources.ts`.
 *
 * Sur une base neuve il n'a rien à faire : `import-prestataire-leader-colis.ts`
 * crée directement l'agence au bon propriétaire.
 *
 * CE QU'IL DÉPLACE, ET CE QU'IL NE TOUCHE PAS
 *
 * Le hub n'est ni supprimé ni recréé : seul son `prestataireId` change, son
 * `id` ne bouge pas. Tout ce qui pointe dessus reste donc valide —
 * `Utilisateur.hubId`, `Commande.hubActuelId`, les bons de distribution,
 * d'envoi, de paiement et de retour, `HistoriqueStatutCommande.hubId`. Les
 * villes suivent d'elles-mêmes, elles sont portées par le hub.
 *
 * Les TARIFS, eux, ne suivent pas tout seuls : `TarifPrestataireVille` est
 * indexée sur (prestataire, ville) et non sur l'agence. Chaque ligne est donc
 * recopiée chez Leader Colis — montant de livraison ET de retour — puis
 * l'originale est SUPPRIMÉE chez Sahario. La supprimer est le point important :
 * une ligne laissée là ne fausserait pas la marge (le coût retenu est celui du
 * prestataire qui EXPLOITE le hub de la ville, § getCoutsSousTraitance), mais
 * elle afficherait une grille Sahario de 65 villes dont 51 qu'il ne dessert
 * pas — une offre inventée, sur laquelle quelqu'un finirait par arbitrer.
 *
 * L'HISTORIQUE N'EST PAS RÉÉCRIT. Les factures déjà émises gardent le coût
 * qu'elles portaient : `LigneFacture.coutLivraison` est figé à l'émission, et
 * le corriger a posteriori changerait des marges déjà arrêtées. Les colis
 * livrés sous l'ancienne attribution restent donc comptés comme du Sahario —
 * c'est assumé, et c'est le seul résidu de l'erreur.
 */

const ANCIEN = 'Sahario Express';
const NOUVEAU = 'Leader Colis';
const AGENCE = 'Agence Agadir';

export async function transfererAgadirLeaderColis(simulation = false): Promise<void> {
  const entete = simulation ? '  (SIMULATION — aucune écriture)' : '';
  console.log(`${AGENCE} : ${ANCIEN} → ${NOUVEAU}${entete}\n`);

  const hub = await prisma.hub.findUnique({
    where: { nom: AGENCE },
    select: {
      id: true,
      ville: true,
      prestataireId: true,
      prestataire: { select: { nom: true } },
      villes: { select: { id: true, nom: true } },
    },
  });

  if (!hub) {
    console.log(`Aucune agence « ${AGENCE} » en base — rien à transférer.`);
    return;
  }

  const proprietaire = hub.prestataire?.nom ?? null;
  if (proprietaire === NOUVEAU) {
    console.log(`Déjà chez ${NOUVEAU} — rien à faire.`);
    return;
  }
  // Un propriétaire inattendu n'est pas le cas que cette correction traite :
  // s'arrêter vaut mieux que déplacer un quai que quelqu'un a rattaché ailleurs
  // pour une raison qui n'est pas écrite ici.
  if (proprietaire !== ANCIEN) {
    throw new Error(
      `« ${AGENCE} » appartient à ${proprietaire ?? 'aucun prestataire (hub interne)'}, ` +
        `et non à ${ANCIEN}. Transfert refusé : ce script ne corrige qu'une attribution connue.`
    );
  }

  const ancien = await prisma.prestataire.findUniqueOrThrow({
    where: { nom: ANCIEN },
    select: { id: true },
  });

  const villeIds = hub.villes.map((v) => v.id);
  const tarifs = await prisma.tarifPrestataireVille.findMany({
    where: { prestataireId: ancien.id, villeId: { in: villeIds } },
    select: { villeId: true, tarifLivraison: true, tarifRetour: true },
  });

  console.log(`${hub.villes.length} ville(s) rattachée(s), ${tarifs.length} tarif(s) à déplacer.`);
  const sansTarif = hub.villes.length - tarifs.length;
  if (sansTarif > 0) {
    console.log(
      `${sansTarif} ville(s) sans tarif ${ANCIEN} : leur coût reste inconnu (null), pas gratuit.`
    );
  }

  if (simulation) {
    console.log(`\nÀ FAIRE : créer « ${NOUVEAU} » si absent, y basculer le hub et ses ${tarifs.length} tarifs.`);
    return;
  }

  // Une seule transaction : un transfert à moitié fait laisserait le hub chez
  // l'un et ses tarifs chez l'autre, état qu'aucun écran ne sait présenter.
  await prisma.$transaction(async (tx) => {
    const nouveau = await tx.prestataire.upsert({
      where: { nom: NOUVEAU },
      update: {},
      create: { nom: NOUVEAU },
    });

    await tx.hub.update({ where: { id: hub.id }, data: { prestataireId: nouveau.id } });

    for (const tarif of tarifs) {
      await tx.tarifPrestataireVille.upsert({
        where: { prestataireId_villeId: { prestataireId: nouveau.id, villeId: tarif.villeId } },
        update: { tarifLivraison: tarif.tarifLivraison, tarifRetour: tarif.tarifRetour },
        create: {
          prestataireId: nouveau.id,
          villeId: tarif.villeId,
          tarifLivraison: tarif.tarifLivraison,
          tarifRetour: tarif.tarifRetour,
        },
      });
    }

    await tx.tarifPrestataireVille.deleteMany({
      where: { prestataireId: ancien.id, villeId: { in: villeIds } },
    });
  });

  console.log(`\nTerminé — « ${AGENCE} » et ses ${tarifs.length} tarifs sont chez ${NOUVEAU}.`);
  console.log(`Les lignes ${ANCIEN} de ces villes ont été retirées : il ne les dessert pas.`);
}

if (lanceDirectement('transferer-agadir-leader-colis')) {
  lancerEnCli(() => transfererAgadirLeaderColis(process.argv.includes('--simuler')));
}
