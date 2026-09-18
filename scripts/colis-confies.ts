import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { villeDesservie, villesDesserviesPar } from '../lib/livraison-statut';
import { normaliserVille } from '../lib/hub-stock';
import { STATUTS_PRESTATAIRE, STATUTS_TERMINAUX } from '../lib/statuts';

/**
 * Quels colis un transporteur peut-il déclarer, et pourquoi pas les autres ?
 *
 *   npm run colis:confies              tous les comptes, les colis déclarables
 *   npm run colis:confies PD-101686    le verdict sur UN colis
 *
 * LECTURE SEULE. Sert à une question qui n'a pas d'écran : l'API de suivi
 * (§ API_SUIVI_PRESTATAIRES.md) répond `404 colis_introuvable` aussi bien pour
 * un code inexistant que pour un colis hors des villes du transporteur — c'est
 * délibéré, distinguer les deux dirait à qui sonde quels codes existent. Mais
 * côté INTERNE, cette confusion coûte cher : un intégrateur qui essaie l'API ne
 * peut pas savoir s'il s'est trompé de code ou de transporteur.
 *
 * LE CRITÈRE EST LA VILLE DE DESTINATION, et lui seul : `Commande.ville`
 * doit figurer parmi les villes desservies par les agences du transporteur.
 * Ni le hub où le colis se trouve, ni une remise enregistrée n'entrent en
 * compte — il n'en existe pas.
 */

// Les colis sont filtrés en MÉMOIRE et non par la requête : `Commande.ville`
// est du texte libre et le rapprochement se fait sur le nom normalisé (casse
// et accents repliés). Le `mode: 'insensitive'` de PostgreSQL ignore la casse
// mais PAS les accents — chercher « Sale » n'y retrouve pas « Salé » (cf.
// SOUS_TRAITANCE.md §2.2). D'où ce plafond, qui borne la lecture.
const COLIS_EXAMINES = 500;

async function colisDeclarables(prestataireId: string, codesDemandes: string[]) {
  const villes = await villesDesserviesPar(prestataireId);

  const candidats = await prisma.commande.findMany({
    where: {
      statut: { notIn: STATUTS_TERMINAUX },
      ...(codesDemandes.length > 0 ? { codeSuivi: { in: codesDemandes } } : {}),
    },
    select: { codeSuivi: true, statut: true, ville: true },
    orderBy: { dateCreation: 'desc' },
    take: COLIS_EXAMINES,
  });

  return {
    nbVilles: villes.size,
    colis: candidats.filter((c) => villeDesservie(villes, c.ville)),
  };
}

/** Verdict sur UN colis : qui peut le déclarer, et pourquoi pas les autres. */
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
      hubActuel: { select: { nom: true } },
    },
  });

  if (!colis) {
    console.log('✗ Ce code de suivi n’existe pas en base.');
    console.log('  L’API répondrait 404 colis_introuvable — comme pour un colis hors périmètre.');
    return;
  }

  console.log(`  Marchand     ${colis.marchand.nomBoutique}`);
  console.log(`  Destinataire ${colis.clientNom} — ${colis.ville}`);
  console.log(`  Statut       ${colis.statut}`);
  // Affiché pour le diagnostic logistique seulement : le hub n'entre PLUS dans
  // le périmètre de l'API.
  console.log(`  Hub actuel   ${colis.hubActuel?.nom ?? '— aucun'}  (sans effet sur l’API)`);

  // On part du RÉFÉRENTIEL, pas des comptes machine : un transporteur peut
  // parfaitement desservir cette ville sans être encore branché à l'API. Les
  // confondre ferait dire « personne ne dessert cette ville » là où il fallait
  // lire « personne n'est branché » — deux diagnostics opposés.
  const villes = await prisma.ville.findMany({
    where: { hub: { prestataireId: { not: null } } },
    select: { nom: true, hub: { select: { prestataire: { select: { id: true, nom: true } } } } },
  });

  const cible = normaliserVille(colis.ville);
  const desservants = new Map<string, string>();
  for (const v of villes) {
    if (normaliserVille(v.nom) !== cible) continue;
    const p = v.hub.prestataire!;
    desservants.set(p.id, p.nom);
  }

  if (desservants.size === 0) {
    console.log(`\n✗ NON DÉCLARABLE : aucun transporteur ne dessert « ${colis.ville} ».`);
    console.log('  Soit la ville est absente du référentiel, soit elle y est écrite autrement.');
    console.log('  Vérifier dans /admin/hubs.');
    return;
  }

  console.log(`\nDesservie par ${desservants.size} transporteur(s) :`);
  let branches = 0;
  for (const [id, nom] of desservants) {
    const compte = await prisma.plateformePartenaire.findFirst({
      where: { prestataireId: id },
      select: {
        code: true,
        actif: true,
        cles: {
          where: { revoqueeLe: null },
          select: { prefixe: true, environnement: true, scopes: true },
        },
      },
    });

    if (!compte) {
      console.log(`  · ${nom} — ⚠ aucun compte machine : pas branché à l'API`);
      continue;
    }
    const utilisables = compte.cles.filter((c) => c.scopes.includes('livraisons:statut'));
    if (utilisables.length === 0) {
      console.log(`  · ${nom} (compte « ${compte.code} ») — ⚠ aucune clé active avec le scope`);
      continue;
    }
    branches += 1;
    console.log(
      `  · ${nom} (compte « ${compte.code} »${compte.actif ? '' : ', DÉSACTIVÉ'}) — ` +
        utilisables.map((c) => `${c.environnement}/${c.prefixe.slice(0, 8)}…`).join(', ')
    );
  }

  console.log(
    branches === 0
      ? '\n✗ NON DÉCLARABLE AUJOURD’HUI : la ville est desservie, mais aucun de ces transporteurs n’a de clé utilisable.'
      : `\n✓ DÉCLARABLE par ${branches} transporteur(s) branché(s).`
  );

  // Une ville annoncée par deux réseaux rend le colis déclarable par les DEUX.
  // C'est la conséquence assumée du critère « ville » : voir l'en-tête de
  // lib/livraison-statut.ts.
  if (desservants.size > 1) {
    console.log('\n⚠ Ville partagée : chacun de ces transporteurs peut clore ce colis.');
  }

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
    console.log(
      avecScope.length === 0
        ? '⚠ Aucune clé active ne porte le scope « livraisons:statut ».'
        : `Clés utilisables : ${avecScope.map((c) => `${c.environnement}/${c.prefixe.slice(0, 8)}…`).join(', ')}`
    );

    const { nbVilles, colis } = await colisDeclarables(prestataire.id, []);
    console.log(`Villes desservies : ${nbVilles}`);

    if (nbVilles === 0) {
      console.log('\n⚠ Ce transporteur n’a AUCUNE ville : il ne peut rien déclarer.');
      console.log('  Charger son réseau (npm run db:reseau) ou lui rattacher des villes.');
      continue;
    }

    if (colis.length === 0) {
      console.log(`\n⚠ AUCUN colis déclarable parmi les ${COLIS_EXAMINES} derniers colis en cours.`);
      console.log('  Aucun colis en circulation n’est destiné à l’une de ses villes.');
      continue;
    }

    console.log(`\n${colis.length} colis déclarable(s) — les 3 premiers pour la collection Postman :\n`);
    for (const [i, c] of colis.slice(0, 15).entries()) {
      const marque = i < 3 ? ['colisA', 'colisB', 'colisC'][i].padEnd(7) : '       ';
      console.log(`  ${marque} ${c.codeSuivi.padEnd(14)} ${c.statut.padEnd(24)} ${c.ville}`);
    }
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
