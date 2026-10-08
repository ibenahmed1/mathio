import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { resoudreVilleImport } from '../lib/prestataires';
import { normaliserVille } from '../lib/hub-envoi';
import { HUBS_REGIONAUX } from '../lib/hubs-regionaux';

/**
 * Rend chaque agence sous-traitée livrable dans SA PROPRE VILLE
 * d'implantation, § /admin/hubs.
 *
 *   npx tsx scripts/ajouter-villes-agences.ts            (applique)
 *   npx tsx scripts/ajouter-villes-agences.ts --simuler  (n'écrit rien)
 *
 * Idempotent : une agence qui dessert déjà sa ville n'est pas touchée.
 *
 * POURQUOI CE SCRIPT EXISTE À PART DES IMPORTS
 *
 * `scripts/import-prestataire-*.ts` transcrivent les fichiers sources à la
 * lettre — c'est leur seule valeur, et `scripts/auditer-conformite-sources.ts`
 * le vérifie. Or les tableurs listent le nom de l'agence comme IMPLANTATION,
 * jamais comme destination : cinq agences sur dix-sept desservaient tout un
 * secteur sans pouvoir recevoir un colis pour la ville où elles sont assises
 * (Oujda, Taounate, El Jadida, Fès, Boulmane). Ajouter ces villes DANS les
 * imports ferait mentir la transcription.
 *
 * C'est donc une DÉCISION MÉTIER, prise le 9 septembre 2026, et tenue à part
 * pour rester visible : nous déclarons que ces agences livrent leur propre
 * ville. `SOUS_TRAITANCE.md §2.10` disait l'inverse — il a été mis à jour.
 *
 * CE QUE ÇA NE FAIT PAS
 *
 * Aucun tarif n'est créé. Le coût de ces villes reste `null`, donc « inconnu »
 * et signalé comme tel à la facturation (Facture.nbLignesCoutInconnu) — jamais
 * 0, qui dirait « gratuit » et gonflerait la marge d'un montant inventé. La
 * question du prix reste ouverte (§ SOUS_TRAITANCE.md §3, question 3).
 *
 * Aucun HUB INTERNE n'est touché non plus. Hub Marrakech et Hub Tanger ne
 * desservent aucune ville et leurs villes partent chez un sous-traitant
 * (§ CORRECTIFS_URGENTS.md §4) : leur en donner basculerait Marrakech et
 * Tanger en livraison interne, ce qui change le routage, le coût et la marge.
 * C'est un arbitrage distinct, qui n'a pas été rendu.
 */

// `simulation` est un paramètre et non une lecture de `process.argv` faite au
// chargement du module : cette étape est aussi appelée par le seed, dont l'`argv`
// est celui de Prisma. Un drapeau lu globalement se serait retrouvé à `false` là
// où l'appelant ne peut pas le poser, et sensible à la ligne de commande d'un
// script tiers qui aurait porté le même mot.
export async function ajouterVillesAgences(simulation = false): Promise<void> {
  // Agences uniquement : `prestataireId` non nul (cf. en-tête).
  const agences = await prisma.hub.findMany({
    where: { prestataireId: { not: null } },
    select: {
      id: true,
      nom: true,
      ville: true,
      prestataire: { select: { nom: true } },
      villes: { select: { nom: true } },
    },
    orderBy: { nom: 'asc' },
  });

  console.log(`${agences.length} agences examinées${simulation ? '  (SIMULATION — aucune écriture)' : ''}\n`);

  let ajoutees = 0;
  let dejaLa = 0;

  // § Réseau en 11 hubs (lib/hubs-regionaux.ts) : un hub régional doit livrer
  // la ville de CHACUNE des agences qu'il a absorbées (Meknès, Taza… pour Hub
  // Fès) — les anciens noms d'agence sont devenus des villes. Le contrôle de
  // présence porte sur TOUTES les villes et non sur le seul hub : une ville ne
  // doit exister qu'une fois dans tout le réseau.
  const existantes = new Set(
    (await prisma.ville.findMany({ select: { nom: true } })).map((v) => normaliserVille(v.nom))
  );
  const sieges = agences.flatMap((agence) => {
    const absorbees = HUBS_REGIONAUX.find((h) => h.nom === agence.nom)?.agences.map((a) => a.ville) ?? [];
    const noms = [agence.ville, ...absorbees].filter((v): v is string => !!v?.trim());
    if (noms.length === 0) console.log(`${agence.nom.padEnd(28)} pas de ville d'implantation déclarée — ignorée`);
    return [...new Set(noms)].map((ville) => ({ ...agence, ville }));
  });

  for (const agence of sieges) {
    // Même rapprochement que le routage (accents et casse repliés) : sans lui,
    // « Fes » et « Fès » cohabiteraient comme deux destinations distinctes.
    const cible = normaliserVille(agence.ville);
    if (existantes.has(cible)) {
      dejaLa += 1;
      continue;
    }
    existantes.add(cible);

    if (simulation) {
      console.log(`${agence.nom.padEnd(28)} À AJOUTER : "${agence.ville}"`);
      ajoutees += 1;
      continue;
    }

    const ville = await resoudreVilleImport(agence.id, agence.ville);
    ajoutees += 1;
    console.log(
      `${agence.nom.padEnd(28)} + "${agence.ville}"  (${agence.prestataire?.nom ?? '—'})${
        ville.renommeeDepuis ? ` — renommée depuis "${ville.renommeeDepuis}"` : ''
      }`
    );
  }

  console.log(
    `\n${ajoutees} ville(s) ${simulation ? 'à ajouter' : 'ajoutée(s)'}, ${dejaLa} déjà présente(s).`
  );
  if (ajoutees > 0 && !simulation) {
    console.log('Aucun tarif créé : le coût de ces villes reste inconnu (null), pas gratuit.');
  }
}

if (lanceDirectement('ajouter-villes-agences')) {
  lancerEnCli(() => ajouterVillesAgences(process.argv.includes('--simuler')));
}
