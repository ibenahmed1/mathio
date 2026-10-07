import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import { HUB_CENTRAL, HUBS_REGIONAUX } from '../lib/hubs-regionaux';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * § Réseau en 11 hubs régionaux (décision du 06/10/2026, lib/hubs-regionaux.ts).
 *
 *   npx tsx scripts/regrouper-hubs-regionaux.ts         à blanc : ce qui serait fait
 *   npx tsx scripts/regrouper-hubs-regionaux.ts --oui   applique
 *
 * Enchaîné aussi en DERNIÈRE étape de `npm run db:reseau` (charger-referentiel).
 *
 * Ce que ça fait, pour chaque hub régional :
 *   1. le hub qui le porte est l'agence de son transporteur installée dans sa
 *      ville (Agence Fès pour Hub Fès) — on la GARDE et on la renomme : son
 *      `id` ne change pas, donc rien de ce qui pointe vers elle ne bouge ;
 *   2. les autres agences absorbées, et un ancien hub interne homonyme (Hub
 *      Marrakech, Hub Tanger), lui DÉVERSENT tout ce qui les référence — villes,
 *      colis présents, comptes rattachés, bons d'envoi, de distribution, de
 *      paiement, de retour, historique — puis sont supprimés.
 * Les villes sont DÉPLACÉES, jamais recréées : `Commande.villeId` et les
 * tarifs (indexés par ville) restent valides, aucun coût d'achat ne change.
 *
 * Avant tout, le hub central est renommé « Hub Central » : il reste séparé, et
 * son ancien nom « Hub Casablanca » devient celui du hub Power.
 *
 * Garde-fous : une ville déjà présente (même nom normalisé) dans le hub cible
 * ARRÊTE tout — fusionner deux lignes de ville est une décision, pas un effet
 * de bord ; un hub central ne peut pas être absorbé. Rejouable : sur une base
 * déjà regroupée, il ne trouve rien à faire.
 */

class Blocage extends Error {}

export async function regrouperHubsRegionaux(simulation = false): Promise<void> {
  console.log(`--- Regroupement en ${HUBS_REGIONAUX.length} hubs régionaux${simulation ? '  (À BLANC)' : ''} ---`);

  // --- Hub central --------------------------------------------------------
  const central = await prisma.hub.findFirst({ where: { isCentral: true }, select: { id: true, nom: true } });
  if (central && central.nom !== HUB_CENTRAL) {
    const pris = await prisma.hub.findFirst({ where: { nom: { equals: HUB_CENTRAL, mode: 'insensitive' } } });
    if (pris) throw new Blocage(`« ${HUB_CENTRAL} » existe déjà et n'est pas le hub central`);
    console.log(`  hub central : « ${central.nom} » → « ${HUB_CENTRAL} »`);
    if (!simulation) await prisma.hub.update({ where: { id: central.id }, data: { nom: HUB_CENTRAL } });
  }

  // --- Hubs régionaux -----------------------------------------------------
  for (const regional of HUBS_REGIONAUX) {
    const prestataire = await prisma.prestataire.findUnique({ where: { nom: regional.prestataire }, select: { id: true } });
    if (!prestataire) {
      console.log(`  ${regional.nom} : transporteur « ${regional.prestataire} » absent — ignoré`);
      continue;
    }

    const porteur = await prisma.hub.findUnique({
      where: { prestataireId_ville: { prestataireId: prestataire.id, ville: regional.ville } },
      select: { id: true, nom: true, isCentral: true },
    });
    if (!porteur) {
      console.log(`  ${regional.nom} : aucune agence ${regional.prestataire} à ${regional.ville} — ignoré`);
      continue;
    }

    const absorbes = await prisma.hub.findMany({
      where: {
        id: { not: porteur.id },
        OR: [
          { prestataireId: prestataire.id, nom: { in: regional.agences.map((a) => a.nom) } },
          // Ancien hub interne du même nom (Hub Marrakech, Hub Tanger).
          // Jamais le hub central, même tant qu'il porte encore l'ancien nom
          // « Hub Casablanca » (à blanc, il n'a pas été renommé ci-dessus).
          { prestataireId: null, isCentral: false, nom: { equals: regional.nom, mode: 'insensitive' } },
        ],
      },
      select: { id: true, nom: true, isCentral: true },
    });
    if (absorbes.some((h) => h.isCentral)) throw new Blocage(`${regional.nom} : le hub central ne peut pas être absorbé`);

    if (absorbes.length === 0 && porteur.nom === regional.nom) continue;

    // Doublons de villes : interdits, on s'arrête avant d'écrire.
    const villesCible = await prisma.ville.findMany({ where: { hubId: porteur.id }, select: { nom: true } });
    const connues = new Set(villesCible.map((v) => normaliserVille(v.nom)));
    for (const a of absorbes) {
      for (const v of await prisma.ville.findMany({ where: { hubId: a.id }, select: { nom: true } })) {
        const cle = normaliserVille(v.nom);
        if (connues.has(cle)) throw new Blocage(`${regional.nom} : « ${v.nom} » (${a.nom}) existe déjà dans le hub — doublon`);
        connues.add(cle);
      }
    }

    console.log(
      `  ${regional.nom.padEnd(16)} ← ${[porteur.nom, ...absorbes.map((a) => a.nom)].join(', ')}  (${connues.size} villes)`
    );
    if (simulation) continue;

    await prisma.$transaction(async (tx) => {
      for (const a of absorbes) {
        const de = { hubId: a.id };
        const vers = { hubId: porteur.id };
        await tx.ville.updateMany({ where: de, data: vers });
        await tx.utilisateur.updateMany({ where: de, data: vers });
        await tx.historiqueStatutCommande.updateMany({ where: de, data: vers });
        await tx.bonDistribution.updateMany({ where: de, data: vers });
        await tx.bonPaiement.updateMany({ where: de, data: vers });
        await tx.bonRetour.updateMany({ where: de, data: vers });
        await tx.commande.updateMany({ where: { hubActuelId: a.id }, data: { hubActuelId: porteur.id } });
        await tx.bonEnvoi.updateMany({ where: { hubDestinationId: a.id }, data: { hubDestinationId: porteur.id } });
        await tx.hub.delete({ where: { id: a.id } });
      }
      if (porteur.nom !== regional.nom) {
        await tx.hub.update({ where: { id: porteur.id }, data: { nom: regional.nom } });
      }
    });
  }

  // --- Hub de test vide (décision du 06/10/2026) --------------------------
  // Seul « Hub Audit Tournée (autre) » part, et seulement s'il est vide : son
  // voisin porte des données d'audit (bons, transactions) que l'on garde.
  const vide = await prisma.hub.findUnique({
    where: { nom: 'Hub Audit Tournée (autre)' },
    select: {
      id: true,
      _count: {
        select: {
          villes: true,
          agentsHub: true,
          commandesActuelles: true,
          historiqueReceptions: true,
          bonsEnvoiDestination: true,
          bonsDistribution: true,
          bonsPaiement: true,
          bonsRetour: true,
        },
      },
    },
  });
  if (vide) {
    const occupe = Object.values(vide._count).some((n) => n > 0);
    console.log(`  Hub Audit Tournée (autre) : ${occupe ? 'NON vide — gardé' : 'vide — supprimé'}`);
    if (!occupe && !simulation) await prisma.hub.delete({ where: { id: vide.id } });
  }

  // --- Contrôle -----------------------------------------------------------
  const villes = await prisma.ville.findMany({ select: { nom: true } });
  const noms = villes.map((v) => normaliserVille(v.nom));
  const doublons = noms.length - new Set(noms).size;
  const agencesRestantes = await prisma.hub.count({ where: { nom: { startsWith: 'Agence ' } } });
  console.log(`  contrôle : ${villes.length} villes, ${doublons} doublon(s), ${agencesRestantes} agence(s) restante(s)`);
  if (!simulation && doublons > 0) throw new Blocage(`${doublons} ville(s) en double après regroupement`);
}

if (lanceDirectement('regrouper-hubs-regionaux')) {
  lancerEnCli(() => regrouperHubsRegionaux(!process.argv.includes('--oui')));
}
