import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

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
  // Entrepôt principal de préparation (Hub.isCentral). Posé UNIQUEMENT à la
  // création du hub : sur une base neuve, sans ce drapeau, aucun hub n'est
  // central et tout colis de stock préparé part en `en_transit` au lieu de
  // rester au quai (cf. lib/hub-stock.ts). Sur une base existante on n'y
  // touche pas — le choix du hub central appartient à l'admin.
  central?: boolean;
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
    central: true,
    villes: [
      ['Casablanca', 15],
      ['Bouskoura', 20],
      ['TIT MELIL', 20],
      ['Dar bouazza', 20],
      ['Deroua', 20],
      ['NOUACER', 20],
      ['TAMARIS', 20],
      ['MEDIOUNA', 20],
      ['Berrechid', 20],
      ['SIDI HAJAJ', 20],
      ['SETTAT', 20],
      ['Ben ahmed', 20],
      ['Lahraouyine', 20],
    ],
  },
  {
    hub: 'Agence El Jadida',
    ville: 'El Jadida',
    interne: false,
    villes: [
      ['l jadida', 20],
      ['SIDI RAHAL', 23],
      ['Azemmour', 23],
      ['Sidi bouzid', 23],
      ['TNIN CHTOUKA - EL JADIDA', 23],
      ['Bir jdid', 23],
      ['SIDI SMAIL', 23],
      ['Khemis des zemamra', 25],
      ['MOULAY ABDELLAH', 23],
      ['Had soualem', 23],
      ['SIDI BENNOUR', 25],
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
      ['TAMANSOURT', 25],
      ['ait aourir', 25],
      ['El Kelaâ des Sraghna', 25],
      ['Chichaoua', 25],
      ['El attaouia', 25],
      ['ouled yahya', 25],
      ['tamelelt', 25],
      ['Sidi bou othmane', 25],
      ['mzoudia', 25],
      ['Mzouda', 25],
      ['ouargui', 25],
      ['kettara', 25],
      ['lamnabeha', 25],
      ['ras elain erhamna', 25],
      ['skhour rehamna', 25],
      ['tassoultante', 25],
      ['sid mokhtar', 25],
      ['lalla takerkoust', 25],
      ['moulay brahim', 25],
      ['tahannaout', 25],
      ['aghmat', 25],
      ['sidi ghiat', 25],
      ['ouled hassoune', 25],
      ['tassaout', 25],
      ['Sidi zouine', 25],
      ['loudaya', 25],
      ['souihla', 25],
      ['Ourika', 25],
      ['choueiter', 25],
      ['Amizmiz', 25],
      ['Imintanoute', 25],
      ['tameslouhte', 25],
      ['Echemmaia', 25],
      ['YOUSSOUFIA', 25],
      ['ASNI', 25],
      ['el ouidane', 25],
      ['Ouaht sidi brahim', 25],
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
      ['SAFI', 23],
      ['Essaouira', 23],
      ['SEBT GZOULA', 23],
      ['Jemaa shaim', 23],
    ],
  },
  {
    hub: 'Agence Rabat',
    ville: 'Rabat',
    interne: false,
    villes: [
      ['Rabat', 20],
      ['Sale', 23],
      ['Temara', 23],
      ['Kenitra', 25],
      ['Bouknadel', 25],
      ['Harhoura', 25],
      ['Mers el kheir', 25],
      ['Ain atiq', 25],
      ['Skhirate', 25],
      // « TEMSENA » et « Tamssna » sont deux lignes du fichier pour ce qui est
      // vraisemblablement la même ville. Les deux sont conservées : trancher
      // serait corriger le fournisseur à sa place.
      ['TEMSENA', 25],
      ['Tamssna', 25],
      ['Ain aouda', 25],
      ['Bouznika', 25],
      ['Allal tazi', 25],
      ['Benslimane', 25],
      ['El arjat', 25],
      ['Sidi taibi', 25],
      ['Sale el jadida', 25],
      ['Bassatine elmnzah', 25],
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
    if (hub.renommeDepuis) console.log(`\nHub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);

    // SEULE écriture de tout l'import sur un Hub — et elle ne vise QUE les hubs
    // que l'import vient de créer.
    //
    // Sur une base neuve, sans ce drapeau, aucun hub n'est central et tout colis
    // de stock préparé part en `en_transit` au lieu de rester au quai
    // (cf. lib/hub-stock.ts) : il faut donc le poser.
    //
    // Sur un hub qui EXISTAIT DÉJÀ, non : ce hub porte des utilisateurs, des
    // colis et des bons: le marquer central changerait le comportement d'un
    // système en service, sur la seule foi d'un script d'import. On le signale,
    // et un humain tranche depuis /admin/hubs.
    if (agence.central) {
      const central = await prisma.hub.findFirst({ where: { isCentral: true }, select: { nom: true } });
      if (central) {
        if (central.nom !== hub.nom) {
          console.log(`\n(hub central déjà défini : « ${central.nom} » — laissé tel quel)`);
        }
      } else if (hub.cree) {
        await prisma.hub.update({ where: { id: hub.id }, data: { isCentral: true } });
        console.log(`\n${hub.nom} — marqué hub CENTRAL à sa création`);
      } else {
        console.log(
          `\n⚠ AUCUN hub central, et « ${hub.nom} » existait déjà : il n'a PAS été modifié.\n` +
            `  Cochez « hub central » sur ce hub depuis /admin/hubs, sinon les colis de stock\n` +
            `  préparés partiront en transit au lieu de rester au quai.`
        );
      }
    }

    console.log(
      `\n${hub.nom} — ${agence.interne ? 'hub interne' : `agence ${prestataire.nom}`} · ${agence.villes.length} villes`
    );

    for (const [nom, tarifLivraison] of agence.villes) {
      // Recherche DANS CETTE AGENCE, et non dans tout le réseau : depuis
      // @@unique([hubId, nom]) sur Ville, chaque prestataire tient sa propre
      // liste, écrite comme son fichier l'écrit. Une ville homonyme chez un
      // concurrent n'est plus un conflit à arbitrer ni une ville à déplacer —
      // ce sont deux offres sur la même ville, ce que le référentiel sait
      // désormais représenter. Et la graphie du fichier fait foi : une ville
      // trouvée à la casse près est RENOMMÉE (cf. resoudreVilleImport).
      const ville = await resoudreVilleImport(hub.id, nom);
      if (ville.cree) villesCreees += 1;
      if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);

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
