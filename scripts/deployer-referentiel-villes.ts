import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { regrouperHubsRegionaux } from './regrouper-hubs-regionaux';
import { appliquerDecisionsVilles } from './decisions-villes-octobre-2026';
import { appliquerRoutageMoinsCher } from './appliquer-routage-moins-cher';
import { lirePhoto, lireReferentiel, type Photo } from './referentiel-villes-photo';
import { codeVille } from '../lib/ville-code';

/**
 * Déploiement du référentiel des villes — UNE commande, qui amène la base à
 * l'état exact de la photo validée (scripts/referentiel-villes-photo.json :
 * 500 villes, 11 hubs régionaux + Hub Central, un transporteur et un tarif
 * par ville).
 *
 *   npx tsx scripts/deployer-referentiel-villes.ts                 (à blanc : n'écrit rien)
 *   npx tsx scripts/deployer-referentiel-villes.ts --oui           (applique)
 *   npx tsx scripts/deployer-referentiel-villes.ts --oui --forcer  (cf. étape 2)
 *
 * Remplace les étapes « villes » des notes de déploiement du 3 et du 7
 * octobre, et y ajoute les décisions des 8 et 9 octobre. Dans l'ordre :
 *
 *   1. Regroupement des agences en 11 hubs régionaux
 *      (scripts/regrouper-hubs-regionaux.ts).
 *   2. Décisions de villes d'octobre, points 1 à 12
 *      (scripts/decisions-villes-octobre-2026.ts) : villes retirées ou
 *      fusionnées AVEC leurs colis rattachés à la ville restante, tarifs, les
 *      46 villes de l'API Power, renommage d'Azrou. `--forcer` passe outre la
 *      garde « tournée interne de Casablanca ouverte ».
 *   3. Alignement sur la photo : ce que les décisions n'ont pas amené
 *      exactement à l'état validé (tarif modifié en production depuis, ville
 *      écrite autrement) est corrigé ici, ligne par ligne, dans une seule
 *      transaction. Rien n'est jamais SUPPRIMÉ à cette étape : une ville
 *      présente en production et absente de la photo est signalée, pas
 *      effacée — elle porte peut-être des colis.
 *   4. Contrôle « une ville, un transporteur » et réalignement des colis en
 *      attente (scripts/appliquer-routage-moins-cher.ts).
 *   5. Contrôle final : la base doit être IDENTIQUE à la photo. Sinon le
 *      script sort en erreur et liste chaque écart.
 *
 * Chaque étape est rejouable : sur une base déjà à jour, elle ne trouve rien
 * à faire. Une étape en échec arrête tout ; les précédentes restent acquises
 * et le script peut être relancé après correction.
 *
 * À BLANC, une base pas encore regroupée en hubs régionaux ne peut être
 * simulée qu'à l'étape 1 : les étapes suivantes cherchent les villes par hub
 * régional. Pour voir le déroulé complet, répéter sur une COPIE de la base de
 * production (cf. la note de déploiement).
 */

class Blocage extends Error {}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const cleVille = (hub: string, nom: string) => `${hub}|${nom}`;

// --- Comparaison base ↔ photo -------------------------------------------------

export interface Ecarts {
  hubs: string[];
  villesManquantes: string[];
  villesEnTrop: string[];
  tarifs: string[];
  numeros: string[];
}

export function nbEcarts(e: Ecarts): number {
  return e.hubs.length + e.villesManquantes.length + e.villesEnTrop.length + e.tarifs.length + e.numeros.length;
}

export function comparer(photo: Omit<Photo, 'prise'>, base: Omit<Photo, 'prise'>): Ecarts {
  const ecarts: Ecarts = { hubs: [], villesManquantes: [], villesEnTrop: [], tarifs: [], numeros: [] };

  const hubsBase = new Map(base.hubs.map((h) => [h.nom, h]));
  for (const h of photo.hubs) {
    const b = hubsBase.get(h.nom);
    if (!b) ecarts.hubs.push(`hub « ${h.nom} » absent`);
    else if (b.prestataire !== h.prestataire || b.isCentral !== h.isCentral) {
      ecarts.hubs.push(`hub « ${h.nom} » : ${b.prestataire ?? 'aucun transporteur'}${b.isCentral ? ' (central)' : ''} au lieu de ${h.prestataire ?? 'aucun transporteur'}${h.isCentral ? ' (central)' : ''}`);
    }
  }
  const hubsPhoto = new Set(photo.hubs.map((h) => h.nom));
  for (const h of base.hubs) if (!hubsPhoto.has(h.nom)) ecarts.hubs.push(`hub « ${h.nom} » en trop`);

  const villesBase = new Map(base.villes.map((v) => [cleVille(v.hub, v.nom), v]));
  const villesPhoto = new Set(photo.villes.map((v) => cleVille(v.hub, v.nom)));
  for (const v of photo.villes) {
    const b = villesBase.get(cleVille(v.hub, v.nom));
    if (!b) {
      ecarts.villesManquantes.push(`${v.hub} / « ${v.nom} »`);
      continue;
    }
    if (b.numero !== v.numero) ecarts.numeros.push(`${v.hub} / « ${v.nom} » : n° ${b.numero} au lieu de ${v.numero}`);
    const attendu = JSON.stringify(v.tarifs);
    const trouve = JSON.stringify(b.tarifs);
    if (attendu !== trouve) ecarts.tarifs.push(`${v.hub} / « ${v.nom} » : ${decrireTarifs(b.tarifs)} au lieu de ${decrireTarifs(v.tarifs)}`);
  }
  for (const v of base.villes) {
    if (!villesPhoto.has(cleVille(v.hub, v.nom))) ecarts.villesEnTrop.push(`${v.hub} / « ${v.nom} »`);
  }
  return ecarts;
}

function decrireTarifs(tarifs: Photo['villes'][number]['tarifs']): string {
  if (tarifs.length === 0) return 'aucun tarif';
  return tarifs.map((t) => `${t.prestataire} ${t.livraison} dh / retour ${t.retour ?? '—'}`).join(', ');
}

function afficherEcarts(e: Ecarts): void {
  const sections: [string, string[]][] = [
    ['Hubs', e.hubs],
    ['Villes absentes de la base', e.villesManquantes],
    ['Villes en base absentes de la photo', e.villesEnTrop],
    ['Tarifs différents', e.tarifs],
    ['Numéros (codes V…) différents', e.numeros],
  ];
  for (const [titre, lignes] of sections) {
    if (lignes.length === 0) continue;
    console.log(`   ${titre} : ${lignes.length}`);
    for (const l of lignes.slice(0, 40)) console.log(`      ${l}`);
    if (lignes.length > 40) console.log(`      … et ${lignes.length - 40} autre(s)`);
  }
}

// --- Étape 3 : alignement sur la photo ---------------------------------------

class Simulation extends Error {
  constructor(readonly lignes: string[]) {
    super('simulation');
  }
}

// Amène les villes et les tarifs à la photo. Les HUBS ne sont pas corrigés
// ici : un hub manquant ou au mauvais transporteur signifie que l'étape 1 n'a
// pas fait son travail, et ce n'est pas à un alignement de tarifs d'en
// décider — blocage.
export async function aligner(tx: Tx, photo: Photo): Promise<string[]> {
  const lignes: string[] = [];

  const ecartsHubs = comparer(photo, await lireReferentiel(tx)).hubs;
  if (ecartsHubs.length > 0) throw new Blocage(`hubs différents de la photo : ${ecartsHubs.join(' ; ')}`);

  const hubs = new Map(
    (await tx.hub.findMany({ select: { id: true, nom: true } })).map((h) => [h.nom, h.id])
  );
  const prestataires = new Map(
    (await tx.prestataire.findMany({ select: { id: true, nom: true } })).map((p) => [p.nom, p.id])
  );

  // Numéros (codes V…) : la photo fait foi. Pour les poser sans buter sur
  // l'index unique en cours de route, tous les numéros passent d'abord en
  // NÉGATIF, puis chaque ville de la photo reçoit le sien ; celles qui restent
  // négatives (hors photo) en reçoivent un neuf au-delà du dernier. Seuls les
  // numéros qui changent RÉELLEMENT sont rapportés.
  const numeroAvant = new Map(
    (await tx.ville.findMany({ select: { id: true, numero: true } })).map((x) => [x.id, x.numero])
  );
  await tx.$executeRaw`UPDATE "villes" SET "numero" = -"numero" WHERE "numero" > 0`;

  for (const v of photo.villes) {
    const hubId = hubs.get(v.hub)!;
    const duHub = await tx.ville.findMany({ where: { hubId }, select: { id: true, nom: true } });

    // 3a. La ville : exacte, sinon même nom à la casse ou aux accents près
    // (renommée, ses colis la suivent), sinon créée.
    let ville = duHub.find((x) => x.nom === v.nom);
    if (!ville) {
      const proche = duHub.filter((x) => normaliserVille(x.nom) === normaliserVille(v.nom));
      if (proche.length > 1) throw new Blocage(`${v.hub} : plusieurs villes s'écrivent comme « ${v.nom} »`);
      if (proche.length === 1 && !photo.villes.some((p) => p.hub === v.hub && p.nom === proche[0].nom)) {
        await tx.ville.update({ where: { id: proche[0].id }, data: { nom: v.nom } });
        lignes.push(`${v.hub} / « ${proche[0].nom} » renommée « ${v.nom} »`);
        ville = { id: proche[0].id, nom: v.nom };
      } else {
        // Numéro explicite : la séquence pourrait en donner un que la photo
        // attribue à une autre ville plus loin dans cette boucle.
        ville = await tx.ville.create({ data: { hubId, nom: v.nom, numero: v.numero }, select: { id: true, nom: true } });
        lignes.push(`${v.hub} / « ${v.nom} » créée`);
      }
    }

    await tx.ville.update({ where: { id: ville.id }, data: { numero: v.numero } });
    const avant = numeroAvant.get(ville.id);
    if (avant !== undefined && avant !== v.numero) {
      lignes.push(`${v.hub} / « ${v.nom} » : code ${codeVille(avant)} → ${codeVille(v.numero)}`);
    }

    // 3b. Ses tarifs : exactement ceux de la photo, ni plus ni moins.
    const enBase = await tx.tarifPrestataireVille.findMany({
      where: { villeId: ville.id },
      select: { id: true, tarifLivraison: true, tarifRetour: true, prestataire: { select: { nom: true } } },
    });
    for (const t of v.tarifs) {
      const prestataireId = prestataires.get(t.prestataire);
      if (!prestataireId) throw new Blocage(`transporteur « ${t.prestataire} » introuvable`);
      const actuel = enBase.find((e) => e.prestataire.nom === t.prestataire);
      const identique =
        actuel &&
        Number(actuel.tarifLivraison) === t.livraison &&
        (actuel.tarifRetour === null ? null : Number(actuel.tarifRetour)) === t.retour;
      if (identique) continue;
      await tx.tarifPrestataireVille.upsert({
        where: { prestataireId_villeId: { prestataireId, villeId: ville.id } },
        update: { tarifLivraison: t.livraison, tarifRetour: t.retour },
        create: { prestataireId, villeId: ville.id, tarifLivraison: t.livraison, tarifRetour: t.retour },
      });
      lignes.push(
        `${v.hub} / « ${v.nom} » : ${t.prestataire} ${t.livraison} dh, retour ${t.retour ?? '—'}` +
          (actuel ? ` (était ${Number(actuel.tarifLivraison)} dh, retour ${actuel.tarifRetour ?? '—'})` : ' (posé)')
      );
    }
    for (const e of enBase) {
      if (v.tarifs.some((t) => t.prestataire === e.prestataire.nom)) continue;
      await tx.tarifPrestataireVille.delete({ where: { id: e.id } });
      lignes.push(`${v.hub} / « ${v.nom} » : tarif ${e.prestataire.nom} retiré (absent de la photo)`);
    }
  }

  // Villes hors photo (hubs de test, villes en trop) : un numéro neuf, après
  // le dernier de la photo, dans leur ordre d'origine ; puis la séquence
  // repart après le plus grand.
  const maxPhoto = Math.max(0, ...photo.villes.map((v) => v.numero));
  const horsPhoto = await tx.ville.findMany({
    where: { numero: { lt: 0 } },
    select: { id: true, nom: true, numero: true },
    orderBy: { numero: 'desc' },
  });
  for (const [i, x] of horsPhoto.entries()) {
    const nouveau = maxPhoto + i + 1;
    await tx.ville.update({ where: { id: x.id }, data: { numero: nouveau } });
    if (-x.numero !== nouveau) lignes.push(`« ${x.nom} » (hors photo) : code ${codeVille(-x.numero)} → ${codeVille(nouveau)}`);
  }
  await tx.$executeRaw`SELECT setval(pg_get_serial_sequence('"villes"', 'numero'), GREATEST((SELECT MAX("numero") FROM "villes"), 1))`;

  return lignes;
}

async function alignerSurPhoto(photo: Photo, simulation: boolean): Promise<boolean> {
  try {
    const lignes = await prisma.$transaction(
      async (tx) => {
        const resultat = await aligner(tx, photo);
        if (simulation) throw new Simulation(resultat);
        return resultat;
      },
      { timeout: 120_000 }
    );
    console.log(lignes.length ? `   ${lignes.length} correction(s) appliquée(s) :` : '   Rien à corriger.');
    for (const l of lignes) console.log(`      ${l}`);
    return true;
  } catch (e) {
    if (e instanceof Simulation) {
      console.log(e.lignes.length ? `   À BLANC — ${e.lignes.length} correction(s) à faire :` : '   Rien à corriger.');
      for (const l of e.lignes) console.log(`      ${l}`);
      return true;
    }
    if (e instanceof Blocage) {
      console.log(`   ✘ Rien n'a été écrit : ${e.message}`);
      return false;
    }
    throw e;
  }
}

// --- Enchaînement -------------------------------------------------------------

async function etape(titre: string, faire: () => Promise<void | boolean>): Promise<boolean> {
  console.log(`\n=== ${titre} ===\n`);
  const avant = process.exitCode;
  process.exitCode = 0;
  const resultat = await faire();
  const ok = resultat !== false && !process.exitCode;
  process.exitCode = ok ? avant : 1;
  if (!ok) console.log(`\n✘ Arrêt à l'étape « ${titre} ». Ne pas contourner : prévenir l'équipe.`);
  return ok;
}

export async function deployerReferentielVilles(options: { simulation: boolean; forcer: boolean }): Promise<void> {
  const { simulation, forcer } = options;
  const photo = lirePhoto();
  console.log(`Référentiel des villes — photo du ${photo.prise} : ${photo.hubs.length} hubs, ${photo.villes.length} villes`);
  console.log(simulation ? 'À BLANC : rien ne sera écrit.' : 'APPLICATION.');

  if (!(await etape('1. Regroupement en hubs régionaux', () => regrouperHubsRegionaux(simulation)))) return;

  const agencesRestantes = await prisma.hub.count({ where: { nom: { startsWith: 'Agence ' } } });
  if (simulation && agencesRestantes > 0) {
    console.log(
      `\nÀ BLANC : ${agencesRestantes} agence(s) restent à regrouper. Les étapes 2 à 5 cherchent les villes par hub ` +
        'régional : elles ne peuvent être simulées qu’une fois l’étape 1 appliquée. Pour voir le déroulé complet, ' +
        'lancer --oui sur une COPIE de la base de production.'
    );
    return;
  }

  if (!(await etape('2. Décisions de villes d’octobre (points 1 à 12)', () => appliquerDecisionsVilles({ simulation, forcer }))))
    return;
  if (!(await etape('3. Alignement sur la photo', () => alignerSurPhoto(photo, simulation)))) return;
  if (!(await etape('4. Une ville, un transporteur', () => appliquerRoutageMoinsCher({ simulation })))) return;

  await etape('5. Contrôle final', async () => {
    const ecarts = comparer(photo, await lireReferentiel());
    if (nbEcarts(ecarts) === 0) {
      console.log(`   ✔ Référentiel identique à la photo du ${photo.prise} : ${photo.hubs.length} hubs, ${photo.villes.length} villes.`);
      return true;
    }
    if (simulation) {
      console.log(`   À BLANC : ${nbEcarts(ecarts)} écart(s) avec la photo, que l'étape 3 corrigera (villes en trop exceptées) :`);
      afficherEcarts(ecarts);
      return ecarts.villesEnTrop.length === 0 && ecarts.hubs.length === 0;
    }
    console.log(`   ✘ ${nbEcarts(ecarts)} écart(s) avec la photo :`);
    afficherEcarts(ecarts);
    return false;
  });
}

if (lanceDirectement('deployer-referentiel-villes')) {
  lancerEnCli(() =>
    deployerReferentielVilles({
      simulation: !process.argv.includes('--oui'),
      forcer: process.argv.includes('--forcer'),
    })
  );
}
