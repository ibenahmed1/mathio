import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { STATUTS_PRESTATAIRE, STATUTS_TERMINAUX } from '../lib/statuts';

/**
 * Quels colis un transporteur peut-il actuellement déclarer ?
 *
 *   npx tsx scripts/colis-confies.ts
 *
 * LECTURE SEULE. Sert à une question qui n'a pas d'écran : l'API de suivi
 * (§ API_SUIVI_PRESTATAIRES.md) répond `404 colis_introuvable` aussi bien pour
 * un code inexistant que pour un colis qui n'est pas dans le périmètre de la
 * clé — c'est délibéré, distinguer les deux dirait à qui sonde quels codes
 * existent. Mais côté INTERNE, cette confusion coûte cher : un intégrateur qui
 * essaie l'API avec un code au hasard ne peut pas savoir s'il s'est trompé de
 * code ou de transporteur.
 *
 * Ce script lève l'ambiguïté depuis notre côté du guichet : pour chaque compte
 * machine rattaché à un transporteur, il liste les colis réellement déclarables
 * — ceux dont le hub actuel est une agence de CE transporteur, et dont le
 * statut n'est pas terminal.
 */

/**
 * Verdict sur UN colis : l'API l'acceptera-t-elle, et de qui ?
 *
 * Reproduit le contrôle de `appliquerStatut` (lib/livraison-statut.ts) en
 * disant, lui, POURQUOI — ce que l'API ne fait jamais côté partenaire.
 */
async function expliquerColis(codeBrut: string): Promise<void> {
  const codeSuivi = codeBrut.trim().toUpperCase();
  console.log(`\n${'='.repeat(72)}`);
  console.log(`COLIS ${codeSuivi}\n`);

  const colis = await prisma.commande.findUnique({
    where: { codeSuivi },
    select: {
      statut: true,
      ville: true,
      clientNom: true,
      marchand: { select: { nomBoutique: true } },
      hubActuel: {
        select: { id: true, nom: true, prestataire: { select: { id: true, nom: true } } },
      },
    },
  });

  if (!colis) {
    console.log('✗ Ce code de suivi n’existe pas en base.');
    console.log('  L’API répondrait 404 colis_introuvable — comme pour un colis hors périmètre.');
    return;
  }

  console.log(`  Marchand    ${colis.marchand.nomBoutique}`);
  console.log(`  Destinataire ${colis.clientNom} — ${colis.ville}`);
  console.log(`  Statut      ${colis.statut}`);
  console.log(`  Hub actuel  ${colis.hubActuel?.nom ?? '— aucun'}`);

  if (!colis.hubActuel) {
    console.log('\n✗ NON DÉCLARABLE : le colis n’est rattaché à aucun hub.');
    console.log('  Il n’a pas encore été réceptionné à un quai. L’API répondra 404.');
    return;
  }

  const prestataire = colis.hubActuel.prestataire;
  if (!prestataire) {
    console.log(`\n✗ NON DÉCLARABLE : « ${colis.hubActuel.nom} » est un hub INTERNE.`);
    console.log('  Ce colis est livré par nos propres livreurs, aucun transporteur ne le porte.');
    console.log('  Pour le confier : /admin/bon-envoi vers une agence de sous-traitance.');
    return;
  }

  const compte = await prisma.plateformePartenaire.findFirst({
    where: { prestataireId: prestataire.id },
    select: {
      code: true,
      actif: true,
      cles: {
        where: { revoqueeLe: null },
        select: { prefixe: true, environnement: true, scopes: true },
      },
    },
  });

  console.log(`\n✓ DÉCLARABLE par « ${prestataire.nom} ».`);

  if (!compte) {
    console.log('✗ Mais ce transporteur n’a AUCUN compte machine : personne ne peut appeler l’API.');
    return;
  }
  const utilisables = compte.cles.filter((c) => c.scopes.includes('livraisons:statut'));
  if (utilisables.length === 0) {
    console.log(`✗ Mais aucune clé active du compte « ${compte.code} » ne porte « livraisons:statut ».`);
    return;
  }
  console.log(
    `  Compte « ${compte.code} », clé(s) : ${utilisables
      .map((c) => `${c.environnement}/${c.prefixe.slice(0, 8)}…`)
      .join(', ')}`
  );

  if (STATUTS_TERMINAUX.includes(colis.statut)) {
    console.log(`\n⚠ Le colis est CLOS (« ${colis.statut} ») : tout nouveau statut répondra`);
    console.log('  409 colis_clos. Rejouer le MÊME statut répondra 200 « inchange ».');
  }
}

async function main(): Promise<void> {
  const cible = process.argv[2];
  if (cible) {
    await expliquerColis(cible);
    return;
  }

  const comptes = await prisma.plateformePartenaire.findMany({
    where: { prestataireId: { not: null } },
    select: {
      code: true,
      nom: true,
      actif: true,
      prestataire: { select: { id: true, nom: true } },
      cles: {
        where: { revoqueeLe: null },
        select: { prefixe: true, environnement: true, scopes: true },
      },
    },
    orderBy: { nom: 'asc' },
  });

  if (comptes.length === 0) {
    console.log('Aucun compte machine n’est rattaché à un transporteur.');
    console.log('→ /admin/integrations, « Nouvelle plateforme », choisir un transporteur.');
    return;
  }

  for (const compte of comptes) {
    const prestataire = compte.prestataire!;
    console.log(`\n${'='.repeat(72)}`);
    console.log(`${compte.nom}  (code « ${compte.code} »${compte.actif ? '' : ', DÉSACTIVÉ'})`);
    console.log(`Transporteur : ${prestataire.nom}`);

    const avecScope = compte.cles.filter((c) => c.scopes.includes('livraisons:statut'));
    if (avecScope.length === 0) {
      console.log('⚠ Aucune clé active ne porte le scope « livraisons:statut ».');
    } else {
      console.log(
        `Clés utilisables : ${avecScope.map((c) => `${c.environnement}/${c.prefixe.slice(0, 8)}…`).join(', ')}`
      );
    }

    const agences = await prisma.hub.findMany({
      where: { prestataireId: prestataire.id },
      select: { id: true, nom: true },
      orderBy: { nom: 'asc' },
    });
    console.log(`Agences : ${agences.length ? agences.map((a) => a.nom).join(', ') : 'aucune'}`);

    // Le périmètre exact de l'API, reproduit à l'identique : hub actuel du
    // colis appartenant à ce transporteur. Les statuts terminaux sont écartés
    // parce qu'ils seraient refusés en 409 colis_clos, pas en succès.
    const colis = await prisma.commande.findMany({
      where: {
        hubActuel: { prestataireId: prestataire.id },
        statut: { notIn: STATUTS_TERMINAUX },
      },
      select: {
        codeSuivi: true,
        statut: true,
        ville: true,
        hubActuel: { select: { nom: true } },
      },
      orderBy: { dateCreation: 'desc' },
      take: 15,
    });

    if (colis.length === 0) {
      console.log('\n⚠ AUCUN colis déclarable.');
      console.log(
        '  Un colis ne devient déclarable que lorsqu’il arrive à une agence de ce\n' +
          '  transporteur — par le circuit normal du bon d’envoi (§ /admin/bon-envoi),\n' +
          '  qui pose son hub actuel. Tant qu’aucun colis n’y est, l’API répondra\n' +
          '  404 sur tout, ce qui est correct.'
      );
      continue;
    }

    console.log(`\n${colis.length} colis déclarable(s) — les 3 premiers pour la collection Postman :\n`);
    for (const [i, c] of colis.entries()) {
      const marque = i < 3 ? ['colisA', 'colisB', 'colisC'][i].padEnd(7) : '       ';
      console.log(
        `  ${marque} ${c.codeSuivi.padEnd(14)} ${c.statut.padEnd(24)} ${c.hubActuel?.nom ?? '—'} — ${c.ville}`
      );
    }
  }

  // Vue d'ensemble : sans elle, un « aucun colis déclarable » ne dit pas s'il
  // n'y a aucun colis du tout, ou s'ils sont simplement ailleurs — et les deux
  // appellent des gestes opposés.
  console.log(`\n${'='.repeat(72)}`);
  console.log('OÙ SONT LES COLIS EN COURS (statut non terminal)\n');

  const hubs = await prisma.hub.findMany({
    select: { id: true, nom: true, prestataire: { select: { nom: true } } },
  });
  const parHub = new Map(hubs.map((h) => [h.id, h]));

  const groupes = await prisma.commande.groupBy({
    by: ['hubActuelId'],
    where: { statut: { notIn: STATUTS_TERMINAUX } },
    _count: { _all: true },
  });

  if (groupes.length === 0) {
    console.log('  Aucun colis en cours dans toute la base.');
  }
  for (const g of groupes.sort((a, b) => b._count._all - a._count._all)) {
    const hub = g.hubActuelId ? parHub.get(g.hubActuelId) : null;
    const ou = hub
      ? `${hub.nom}${hub.prestataire ? ` (${hub.prestataire.nom})` : ' (interne)'}`
      : 'aucun hub — pas encore réceptionné';
    console.log(`  ${String(g._count._all).padStart(5)}  ${ou}`);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`Statuts qu’un transporteur peut poser : ${STATUTS_PRESTATAIRE.join(', ')}`);
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
