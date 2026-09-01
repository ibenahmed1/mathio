import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport } from '../lib/prestataires';

/**
 * Import de la grille de sous-traitance Power Delivery (§ /admin/hubs,
 * § /admin/prestataires), exécutable via
 * `npx tsx scripts/import-prestataire-power-delivery.ts`.
 *
 * Ce n'est PAS un seed : le seed ne crée que le compte administrateur, et le
 * référentiel géographique est une donnée d'exploitation qui vit en base (cf.
 * prisma/seed.ts). C'est un outil de chargement initial d'une grille
 * fournisseur reçue en Excel — le contenu ci-dessous est la transcription du
 * fichier "ville Power.pdf", et fait foi une fois seulement : dès la première
 * modification faite depuis l'application, c'est la base qui a raison.
 *
 * Idempotent et non destructif : tout est en upsert par clé métier (nom du
 * prestataire, nom du hub, nom de la ville, couple prestataire×ville). Aucun
 * hub, ville ou tarif absent de ce fichier n'est supprimé ni modifié — un
 * second passage ne fait que réaligner les tarifs.
 *
 * Modèle appliqué (cf. les commentaires de Hub.prestataireId dans
 * prisma/schema.prisma) : le mode de livraison se décide PAR VILLE, via le hub
 * qui la couvre. Hub Casablanca reste un hub interne (nos livreurs et
 * ramasseurs, § /admin/bon-distribution) ; les quatre autres blocs du fichier
 * deviennent des agences rattachées à Power Delivery. Les tarifs, eux, sont
 * chargés pour LES 87 VILLES du fichier — y compris celles de Casablanca que
 * nous livrons nous-mêmes aujourd'hui : la grille dit ce que le prestataire
 * nous facturerait, pas qui livre. C'est exactement pour ça que
 * TarifPrestataireVille est indexé sur (prestataire, ville) et non sur
 * l'agence, et c'est ce qui permettra plus tard de comparer une ville livrée
 * en interne au prix qu'elle coûterait en sous-traitance.
 */

const PRESTATAIRE = {
  nom: 'Power Delivery',
  contact: null as string | null,
  telephone: null as string | null,
  email: null as string | null,
};

type LigneVille = [nom: string, tarifLivraison: number];

type AgenceImport = {
  // Nom du Hub en base. "Hub Casablanca" existe déjà et garde son nom : c'est
  // notre hub central, il n'est pas rattaché au prestataire.
  hub: string;
  // Hub.ville — la ville où se trouve physiquement le quai.
  ville: string;
  // false = agence du prestataire (Hub.prestataireId renseigné).
  interne: boolean;
  villes: LigneVille[];
};

// Transcription du fichier fournisseur. Les noms sont normalisés en casse
// française (le fichier mélange MAJUSCULES et minuscules) ; les tarifs sont
// repris tels quels, en dirhams.
//
// Les noms sont ceux du fichier, MOT POUR MOT — casse comprise, suffixes
// compris ("TNIN CHTOUKA - EL JADIDA", "Sidi moussa - Marrakech"). Une version
// antérieure les normalisait et fusionnait les graphies concurrentes ; c'est
// l'inverse de ce que l'écran doit montrer d'une grille reçue.
//
// Les lignes que le fichier écrit DEUX FOIS avec deux graphies sont donc toutes
// conservées, chacune la sienne : "ait aourir" et "Aït ourir", "tamelelt" et
// "Tamallalt", "TEMSENA" et "Tamssna". Elles désignent vraisemblablement la
// même ville, mais trancher reviendrait à corriger le fournisseur à sa place —
// et le tarif étant identique, l'ambiguïté ne coûte rien.
//
// SEULE EXCEPTION, faute de mieux : "ouargui" figure deux fois dans le bloc
// Marrakech, à l'identique. Deux lignes rigoureusement identiques dans la même
// agence ne peuvent pas coexister (§ @@unique([hubId, nom]) sur Ville) et,
// surtout, ne seraient pas distinguables à l'écran — deux puces jumelles
// qu'aucune action ne saurait viser séparément. La ligne n'apparaît donc
// qu'une fois, et c'est le seul écart au fichier.
const AGENCES: AgenceImport[] = [
  {
    hub: 'Hub Casablanca',
    ville: 'Casablanca',
    interne: true,
    villes: [
      ['Casablanca', 15],
      ['Bouskoura', 20],
      ['Tit Melil', 20],
      ['Dar Bouazza', 20],
      ['Deroua', 20],
      ['Nouacer', 20],
      ['Tamaris', 20],
      ['Mediouna', 20],
      ['Berrechid', 20],
      ['Sidi Hajaj', 20],
      ['Settat', 20],
      ['Ben Ahmed', 20],
      ['Lahraouyine', 20],
    ],
  },
  {
    hub: 'Agence El Jadida',
    ville: 'El Jadida',
    interne: false,
    villes: [
      ['l jadida', 20],
      ['Sidi Rahal', 23],
      ['Azemmour', 23],
      ['Sidi Bouzid', 23],
      ['TNIN CHTOUKA - EL JADIDA', 23],
      ['Bir Jdid', 23],
      ['Sidi Smail', 23],
      ['Khemis des Zemamra', 25],
      ['Moulay Abdellah', 23],
      ['Had Soualem', 23],
      ['Sidi Bennour', 25],
    ],
  },
  {
    hub: 'Agence Marrakech',
    ville: 'Marrakech',
    interne: false,
    villes: [
      ['Ben Guerir', 25],
      ['Demnat', 25],
      ['Marrakech', 20],
      ['Tamansourt', 25],
      ['ait aourir', 25],
      ['El Kelaâ des Sraghna', 25],
      ['Chichaoua', 25],
      ['El Attaouia', 25],
      ['Ouled Yahya', 25],
      ['tamelelt', 25],
      ['Sidi Bou Othmane', 25],
      ['Mzoudia', 25],
      ['Mzouda', 25],
      ['Ouargui', 25],
      ['Kettara', 25],
      ['Lamnabeha', 25],
      ['Ras El Ain Rhamna', 25],
      ['Skhour Rehamna', 25],
      ['Tassoultante', 25],
      ['Sid Mokhtar', 25],
      ['Lalla Takerkoust', 25],
      ['Moulay Brahim', 25],
      ['Tahannaout', 25],
      ['Aghmat', 25],
      ['Sidi Ghiat', 25],
      ['Ouled Hassoune', 25],
      ['Tassaout', 25],
      ['Sidi Zouine', 25],
      ['Loudaya', 25],
      ['Souihla', 25],
      ['Ourika', 25],
      ['Choueiter', 25],
      ['Amizmiz', 25],
      ['Imintanoute', 25],
      ['Tameslouhte', 25],
      ['Echemmaia', 25],
      ['Youssoufia', 25],
      ['Asni', 25],
      ['El Ouidane', 25],
      ['Ouaht Sidi Brahim', 25],
      ['Sidi moussa - Marrakech', 25],
      // Secondes graphies du MÊME fichier : « Aït ourir » (p.2) redit
      // « ait aourir » (p.1), « Tamallalt » redit « tamelelt ». Elles sont
      // conservées telles quelles — l'écran doit montrer la grille reçue, pas
      // une version corrigée. Elles se distinguent en base depuis l'unicité
      // par hub (§ @@unique([hubId, nom])).
      ['Aït ourir', 25],
      ['Tamallalt', 25],
    ],
  },
  {
    hub: 'Agence Safi',
    ville: 'Safi',
    interne: false,
    villes: [
      ['Safi', 23],
      ['Essaouira', 23],
      ['Sebt Gzoula', 23],
      ['Jemaa Shaim', 23],
    ],
  },
  {
    hub: 'Agence Rabat',
    ville: 'Rabat',
    interne: false,
    villes: [
      ['Rabat', 20],
      ['Salé', 23],
      ['Témara', 23],
      ['Kénitra', 25],
      ['Bouknadel', 25],
      ['Harhoura', 25],
      ['Mers El Kheir', 25],
      ['Aïn Atiq', 25],
      ['Skhirate', 25],
      // « TEMSENA » et « Tamssna » sont deux lignes du fichier pour ce qui est
      // vraisemblablement la même ville. Les deux sont conservées : trancher
      // serait corriger le fournisseur à sa place.
      ['TEMSENA', 25],
      ['Tamssna', 25],
      ['Aïn Aouda', 25],
      ['Bouznika', 25],
      ['Allal Tazi', 25],
      ['Benslimane', 25],
      ['El Arjat', 25],
      ['Sidi Taibi', 25],
      ['Salé El Jadida', 25],
      ['Bassatine El Menzah', 25],
    ],
  },
];

async function main() {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE.nom },
    // Ne réécrit pas les coordonnées si le prestataire a déjà été complété
    // depuis l'application — le fichier fournisseur ne les porte pas.
    update: {},
    create: PRESTATAIRE,
  });
  console.log(`Prestataire : ${prestataire.nom} (${prestataire.id})`);

  let villesCreees = 0;
  let tarifs = 0;

  for (const agence of AGENCES) {
    const prestataireId = agence.interne ? null : prestataire.id;

    // Un hub existant n'est jamais réécrit : ni ses coordonnées — renseignées
    // dans l'application, le fichier fournisseur ne les connaît pas — ni son
    // rattachement, qu'un import n'a pas à changer sous les pieds d'un autre
    // réseau (§ resoudreHubImport).
    const hub = await resoudreHubImport({ prestataireId, ville: agence.ville, nom: agence.hub });
    console.log(
      `\n${hub.nom} — ${agence.interne ? 'hub interne' : `agence ${prestataire.nom}`} · ${agence.villes.length} villes`
    );

    for (const [nom, tarifLivraison] of agence.villes) {
      // Recherche DANS CETTE AGENCE, et non dans tout le réseau : depuis
      // @@unique([hubId, nom]) sur Ville, chaque prestataire tient sa propre
      // liste, écrite comme son fichier l'écrit. Une ville homonyme chez un
      // concurrent n'est plus un conflit à arbitrer ni une ville à déplacer —
      // ce sont deux offres sur la même ville, ce que le référentiel sait
      // désormais représenter.
      const ville =
        (await prisma.ville.findUnique({ where: { hubId_nom: { hubId: hub.id, nom } } })) ??
        (await prisma.ville.create({ data: { nom, hubId: hub.id } }).then((v) => {
          villesCreees += 1;
          return v;
        }));

      await prisma.tarifPrestataireVille.upsert({
        where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: ville.id } },
        update: { tarifLivraison },
        create: { prestataireId: prestataire.id, villeId: ville.id, tarifLivraison },
      });
      tarifs += 1;
    }
  }

  console.log(
    `\nTerminé — ${tarifs} tarifs ${prestataire.nom} en base, ${villesCreees} villes créées.`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
