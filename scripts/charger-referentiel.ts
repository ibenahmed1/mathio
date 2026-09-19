import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { detecterBlocages } from './verifier-avant-reseau';
import { alignerNomsSurSources } from './aligner-noms-sur-sources';
import { importerPowerDelivery } from './import-prestataire-power-delivery';
import { importerMetaLivraison } from './import-prestataire-meta-livraison';
import { importerSaharioExpress } from './import-prestataire-sahario-express';
import { importerAgenceTanger } from './import-agence-tanger';
import { importerEstLivraison } from './import-prestataire-est-livraison';
import { ajouterVillesAgences } from './ajouter-villes-agences';

/**
 * Chargement du référentiel de sous-traitance — prestataires, agences, villes
 * couvertes et tarifs.
 *
 *   npm run db:reseau                      chargement complet
 *   npm run db:reseau -- --ignorer-blocages  malgré un conflit détecté
 *
 * Appelé aussi par `prisma/seed.ts`, ce qui rend le déploiement d'une base
 * neuve tenable en deux commandes (`db:deploy` puis `build`) au lieu d'une
 * séquence de sept scripts à retrouver un par un. C'est la raison d'être de ce
 * fichier : les étapes existaient déjà, rien ne les enchaînait autrement qu'un
 * `&&` dans `package.json`, illisible pour qui ne connaît pas le dépôt.
 *
 * L'ORDRE N'EST PAS ARBITRAIRE, et c'est pour ça qu'il vit ici plutôt que dans
 * une ligne de `package.json` :
 *
 *   1. l'alignement des graphies passe d'abord, pour rendre au document les
 *      noms qu'une exécution antérieure aurait normalisés — sur une base neuve
 *      il ne trouve aucun hub et ne fait rien, silencieusement (§ en-tête de
 *      `aligner-noms-sur-sources.ts`) ;
 *   2. Power Delivery ensuite, parce que c'est le seul import qui porte le hub
 *      interne et pose le drapeau `isCentral` à sa création — sans quoi tout
 *      colis de stock préparé partirait en `en_transit` au lieu de rester au
 *      quai (cf. lib/hub-stock.ts) ;
 *   3. les autres réseaux, dans l'ordre où leurs grilles ont été reçues ;
 *   4. les villes d'implantation des agences en DERNIER, puisque cette étape
 *      lit les agences que les imports viennent de créer.
 *
 * Idempotent : tout est en upsert par clé métier, aucun hub, ville ou tarif
 * absent des sources n'est supprimé. Rejouable sans risque — à une réserve
 * près, qui vaut d'être connue : un second passage RÉALIGNE les tarifs sur les
 * fichiers sources. Une correction saisie depuis /admin/prestataires est donc
 * écrasée. C'est précisément pourquoi le seed ne rappelle pas cette fonction
 * sur une base qui a déjà ses prestataires (cf. prisma/seed.ts).
 */

type Etape = { libelle: string; executer: () => Promise<void> };

const ETAPES: Etape[] = [
  { libelle: 'Graphies rendues aux documents sources', executer: alignerNomsSurSources },
  { libelle: 'Power Delivery', executer: importerPowerDelivery },
  { libelle: 'Meta Livraison', executer: importerMetaLivraison },
  { libelle: 'Sahario Express', executer: importerSaharioExpress },
  { libelle: 'Amir Livraison — agence Tanger', executer: importerAgenceTanger },
  { libelle: 'EST Livraison', executer: importerEstLivraison },
  { libelle: "Villes d'implantation des agences", executer: ajouterVillesAgences },
];

export type OptionsChargement = {
  /**
   * Passe outre les conflits détectés avant chargement. À n'utiliser qu'après
   * avoir lu `npx tsx scripts/verifier-avant-reseau.ts` et décidé que le
   * conflit est acceptable — les imports peuvent alors échouer en cours de
   * route, sur une base à moitié chargée.
   */
  ignorerBlocages?: boolean;
};

export async function chargerReferentiel(options: OptionsChargement = {}): Promise<void> {
  // Le contrôle passe AVANT la première écriture, et il arrête. Le même
  // contrôle existait déjà en lecture seule, dans un script séparé qu'il
  // fallait penser à lancer et lire : personne ne le faisait, et le conflit
  // qu'il signale — deux hubs pour la même ville, l'un recevant les villes et
  // les tarifs, l'autre gardant les colis et les utilisateurs — ne se voit
  // qu'une fois les dégâts faits.
  const blocages = await detecterBlocages();
  if (blocages.length > 0) {
    const liste = blocages.map((b) => `  ⚠ ${b}`).join('\n');
    if (!options.ignorerBlocages) {
      throw new Error(
        `Chargement du référentiel REFUSÉ — ${blocages.length} conflit(s) à régler d'abord :\n${liste}\n\n` +
          'Le détail complet : npx tsx scripts/verifier-avant-reseau.ts\n' +
          'Pour charger malgré tout : npm run db:reseau -- --ignorer-blocages'
      );
    }
    console.log(`Conflit(s) IGNORÉS sur demande explicite :\n${liste}\n`);
  }

  for (const [index, etape] of ETAPES.entries()) {
    console.log(`\n═══ ${index + 1}/${ETAPES.length} — ${etape.libelle} ═══\n`);
    await etape.executer();
  }

  // Récapitulatif LU EN BASE, et non additionné au fil des étapes : c'est le
  // seul chiffre qui dit ce qu'il y a vraiment, upserts et réutilisations
  // comprises. Un compteur incrémenté par les imports dirait ce qu'ils ont
  // cru faire.
  const [prestataires, hubs, agences, villes, tarifs] = await Promise.all([
    prisma.prestataire.count(),
    prisma.hub.count(),
    prisma.hub.count({ where: { prestataireId: { not: null } } }),
    prisma.ville.count(),
    prisma.tarifPrestataireVille.count(),
  ]);

  console.log('\n═══ RÉFÉRENTIEL EN BASE ═══\n');
  console.log(`   ${prestataires} prestataire(s)`);
  console.log(`   ${hubs} hub(s), dont ${agences} agence(s) de prestataire`);
  console.log(`   ${villes} ville(s)`);
  console.log(`   ${tarifs} tarif(s) prestataire×ville`);

  const central = await prisma.hub.findFirst({ where: { isCentral: true }, select: { nom: true } });
  if (central) {
    console.log(`   hub central : « ${central.nom} »`);
  } else {
    console.log(
      '\n   ⚠ AUCUN hub central. À cocher depuis /admin/hubs, sinon les colis de stock\n' +
        '     préparés partiront en transit au lieu de rester au quai.'
    );
  }
  console.log('');
}

if (lanceDirectement('charger-referentiel')) {
  lancerEnCli(() =>
    chargerReferentiel({ ignorerBlocages: process.argv.includes('--ignorer-blocages') })
  );
}
