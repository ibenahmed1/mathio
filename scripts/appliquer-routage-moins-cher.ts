import 'dotenv/config';
import type { StatutCommande } from '../app/generated/prisma/enums';
import { prisma } from '../lib/prisma';
import { chargerReferentielRoutage, cleRoutage, villesPartagees } from '../lib/hub-envoi';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Mise en production de la règle « le moins cher » du 5 octobre 2026
 * (§ meilleurHub, lib/hub-envoi.ts).
 *
 *   npx tsx scripts/appliquer-routage-moins-cher.ts         (à blanc : contrôle et rapport, n'écrit rien)
 *   npx tsx scripts/appliquer-routage-moins-cher.ts --oui   (réaligne les colis en attente)
 *
 * La règle elle-même est du CODE : dès le déploiement, tout nouveau colis d'une
 * ville desservie par plusieurs transporteurs part chez le moins cher. Ce
 * script fait les deux choses que le code ne fait pas seul :
 *
 *   1. CONTRÔLE. Le choix dépend des tarifs EN BASE. Il compare ce que la base
 *      de production retient à ce que l'exploitation a validé (ATTENDU) : un
 *      tarif manquant ou différent en production changerait le transporteur
 *      sans que personne ne le voie. Tout écart est listé, et le script sort
 *      en erreur.
 *
 *   2. COLIS EN ATTENTE. Un colis créé AVANT le déploiement garde son
 *      `villeId` d'origine, qui porte le coût d'achat (§ getCoutsPrestataire).
 *      Son routage, lui, suit déjà la nouvelle règle (calculé au bon
 *      d'envoi) : il partirait chez le moins cher mais serait facturé au tarif
 *      de l'autre. Le script réaligne `villeId` sur la ville retenue — et
 *      SEULEMENT pour les colis pas encore confiés : sans bon d'envoi, sans
 *      remise à un transporteur, dans un statut d'avant la remise. Un colis
 *      déjà parti chez un transporteur reste à lui.
 *
 * Idempotent, en une transaction ; refuse d'écrire si le contrôle échoue.
 */

// Ce que l'exploitation a validé le 5 octobre 2026 (VILLES_TRANSPORTEUR_RETENU.html).
// Clé : nom de ville tel que l'expose villesPartagees() ; valeur : agence retenue.
//
// Depuis le 05/10/2026, chaque ville n'a plus qu'UN transporteur (les villes
// partagées ont été tranchées par scripts/decisions-villes-octobre-2026.ts) :
// la liste est vide, et toute ville partagée apparue en production est un écart.
const ATTENDU: Record<string, string> = {};

// Statuts d'avant toute remise à un transporteur.
const STATUTS_EN_ATTENTE: StatutCommande[] = ['nouveau_colis', 'attente_de_ramassage', 'ramasse', 'recu', 'recu_au_hub'];

// Même clé que le routage : une ville partagée peut s'afficher sous l'une ou
// l'autre de ses graphies (« OUAD AMLIL » ou « Oued Amlil »).
const ATTENDU_PAR_CLE = new Map(Object.entries(ATTENDU).map(([nom, agence]) => [cleRoutage(nom), { nom, agence }]));

export async function appliquerRoutageMoinsCher(options: { simulation?: boolean } = {}): Promise<void> {
  const { simulation = true } = options;

  // 1. Contrôle.
  const partagees = await villesPartagees();
  console.log(`Villes desservies par plusieurs transporteurs : ${partagees.length}\n`);
  const vues = new Set<string>();
  const ecarts: string[] = [];
  for (const p of partagees) {
    const k = cleRoutage(p.nom);
    vues.add(k);
    const attendu = ATTENDU_PAR_CLE.get(k)?.agence;
    const marque = attendu === undefined ? '?' : attendu === p.retenu ? '✔' : '✘';
    console.log(`   ${marque} ${p.nom.padEnd(14)} ${p.hubs.join(' / ').padEnd(42)} → ${p.retenu}`);
    if (attendu === undefined) ecarts.push(`« ${p.nom} » partagée mais non prévue : retenue → ${p.retenu}`);
    else if (attendu !== p.retenu) ecarts.push(`« ${p.nom} » : attendu ${attendu}, la base retient ${p.retenu} (tarifs à vérifier)`);
  }
  for (const [k, { nom }] of ATTENDU_PAR_CLE) {
    if (!vues.has(k)) ecarts.push(`« ${nom} » n'est desservie que par un transporteur en base (ville ou agence manquante)`);
  }
  if (ecarts.length > 0) {
    console.log(`\n✘ ${ecarts.length} écart(s) avec ce qui a été validé — rien n'est écrit :`);
    for (const e of ecarts) console.log(`   ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    ATTENDU_PAR_CLE.size === 0
      ? '✔ Aucune ville n’est desservie par plusieurs transporteurs.\n'
      : `\n✔ Les ${ATTENDU_PAR_CLE.size} villes partent chez le transporteur validé.\n`
  );

  // 2. Colis en attente.
  const referentiel = await chargerReferentielRoutage();
  const colis = await prisma.commande.findMany({
    where: {
      villeId: { not: null },
      bonEnvoiId: null,
      statut: { in: STATUTS_EN_ATTENTE },
      remisesPrestataire: { none: { active: true } },
    },
    select: { id: true, codeSuivi: true, villeId: true, ville: true },
  });
  const nomVille = new Map(referentiel.villes.map((v) => [v.id, v.nom]));
  const aRealigner = colis.flatMap((c) => {
    const retenue = referentiel.preferee(c.villeId!);
    return retenue && retenue.id !== c.villeId ? [{ ...c, vers: retenue }] : [];
  });

  console.log(`Colis en attente à réaligner : ${aRealigner.length}`);
  for (const c of aRealigner.slice(0, 50)) {
    console.log(`   ${c.codeSuivi.padEnd(14)} « ${nomVille.get(c.villeId!)} » → « ${c.vers.nom} »`);
  }
  if (aRealigner.length > 50) console.log(`   … et ${aRealigner.length - 50} autre(s)`);

  if (simulation) {
    console.log('\nÀ BLANC — rien n’a été écrit. Relancer avec --oui pour réaligner.');
    return;
  }
  if (aRealigner.length === 0) return;

  await prisma.$transaction(
    aRealigner.map((c) =>
      prisma.commande.updateMany({
        // Même garde qu'à la lecture : un colis remis entre-temps n'est pas touché.
        where: { id: c.id, villeId: c.villeId, bonEnvoiId: null, statut: { in: STATUTS_EN_ATTENTE } },
        data: { villeId: c.vers.id },
      })
    )
  );
  console.log(`\n${aRealigner.length} colis réaligné(s).`);
}

if (lanceDirectement('appliquer-routage-moins-cher')) {
  lancerEnCli(() => appliquerRoutageMoinsCher({ simulation: !process.argv.includes('--oui') }));
}
