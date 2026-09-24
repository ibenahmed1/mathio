import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import du réseau Leader Colis (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-prestataire-leader-colis.ts`.
 *
 * Une seule agence, Agadir, sur le Souss : c'est Leader Colis qui sert ces 51
 * villes. Idempotent et non destructif, comme les autres imports.
 *
 * POURQUOI CE FICHIER EST NÉ D'UNE SCISSION
 *
 * Ces 51 villes ont d'abord été importées sous « Sahario Express », dans
 * `scripts/import-prestataire-sahario-express.ts`, au même titre que l'Agence
 * Guelmim. C'était une ERREUR D'ATTRIBUTION, corrigée le 23 septembre 2026 :
 * Sahario ne dessert que Guelmim. Le transfert des bases déjà chargées est fait
 * par `scripts/transferer-agadir-leader-colis.ts`, une fois, à la main — les
 * imports refusent volontairement de déplacer un quai d'un réseau à l'autre
 * (§ `resoudreHubImport`, lib/prestataires.ts).
 *
 * L'enjeu n'était pas cosmétique : le coût d'un colis est celui du prestataire
 * qui EXPLOITE le hub de sa ville (§ `getCoutsSousTraitance`), donc ces 51
 * villes étaient facturées en marge comme du Sahario.
 *
 * ⚠️ À CONFIRMER : la grille reprise ci-dessous est celle des messages reçus
 * pour Agadir. Ils ont été classés « Sahario » à la réception ; l'attribution à
 * Leader Colis vient du donneur d'ordre, pas d'un en-tête du document. Si la
 * grille a en réalité été transmise PAR Sahario pour le compte de Leader Colis,
 * c'est la relation commerciale qu'il faut écrire, pas seulement le nom
 * (§ SOUS_TRAITANCE.md §3, question 18).
 *
 * L'Agence Agadir est tarifée par ZONE (15 / 20 / 23 dh) et non ville par
 * ville : la structure du fichier source est conservée ci-dessous, chaque zone
 * portant son prix une seule fois.
 *
 * À l'intérieur de la zone 23, « Taroudant : », « Tiznit : » et
 * « Oulad teima : » introduisaient leurs localités. Ce sont des en-têtes de
 * groupe, pas des destinations : les trois chefs-lieux ne sont pas créés
 * (§ SOUS_TRAITANCE.md §2.3).
 */

const PRESTATAIRE = 'Leader Colis';

type Zone = { tarif: number; villes: string[] };
type AgenceImport = { hub: string; ville: string; zones: Zone[] };

const AGENCES: AgenceImport[] = [
  {
    hub: 'Agence Agadir',
    ville: 'Agadir',
    zones: [
      // « ait mlloul » est la graphie du message. Une version antérieure la
      // corrigeait en « Ait Melloul » : une grille fournisseur se recopie, elle
      // ne se corrige pas.
      { tarif: 15, villes: ['Agadir', 'dchaira', 'inzgane', 'ait mlloul'] },
      {
        tarif: 20,
        villes: [
          'Sidi bibi',
          'Anza',
          'Aourir',
          'Biougra',
          'Ait aamira',
          'Tadart anza',
          'Tamraght',
          'Tarast',
          'Drarga',
          'Tikiwine',
          'Leqliaa',
          'tamait',
        ],
      },
      {
        tarif: 23,
        villes: [
          // Les messages écrivent « . Taroudant : », « . Tiznit : » et
          // « . Oulad teima : » en EN-TÊTES de groupe — un point devant, deux
          // points derrière — suivis de leurs localités. Ce sont des repères de
          // lecture, pas des destinations : les trois chefs-lieux ne sont donc
          // PAS créés. Une version antérieure en faisait des villes livrables à
          // 23 DH, ce qui ajoutait trois destinations que le fournisseur n'a
          // jamais annoncées.
          //
          // Secteur Taroudant
          'Zaouiat',
          'iferkane',
          'Ait aiaaza',
          'El nouwayle',
          'Oulad aarfa',
          'taliwin',
          'awlouz',
          'oulad berhil',
          // Secteur Tiznit
          'Anzi',
          'tighmi',
          'idawsmlal',
          'tafraout',
          'ait jraj',
          'lakhssas',
          'bounaiman',
          'sihll',
          'merleft',
          'sidi fini',
          'aglou',
          'lmaader',
          'rasmouka',
          'wijan',
          // Secteur Oulad Teima
          // Orthographe du message. Elle portait une précision « (Oulad Teima) »
          // tant que `Ville.nom` était unique pour tout le réseau, pour ne pas
          // entrer en collision avec la Sidi Moussa de Marrakech ; l'unicité
          // par hub (§ @@unique([hubId, nom])) rend cette béquille inutile.
          'Sidi moussa',
          'lhamri',
          'Sebt el guerdane',
          'Douar sulad',
          'said Qrarma',
          'Lakhnafif',
          'El koudia',
          'Lagfifat',
          'Ain seddaq',
          'Belfaa',
          'massa',
          'taghazout',
          'imi wadar',
        ],
      },
    ],
  },
];

export async function importerLeaderColis(): Promise<void> {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE },
    update: {},
    create: { nom: PRESTATAIRE },
  });
  console.log(`Prestataire : ${prestataire.nom} (${prestataire.id})`);

  let creees = 0;
  let tarifs = 0;

  for (const agence of AGENCES) {
    const hub = await resoudreHubImport({
      prestataireId: prestataire.id,
      ville: agence.ville,
      nom: agence.hub,
    });

    const total = agence.zones.reduce((t, z) => t + z.villes.length, 0);
    console.log(`\n${hub.nom} — ${total} villes`);
    if (hub.renommeDepuis) console.log(`   Hub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);

    for (const zone of agence.zones) {
      for (const nom of zone.villes) {
        // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville) :
        // une ville homonyme chez un autre réseau n'est pas un conflit, c'est
        // une seconde offre sur la même ville. La graphie du message fait foi.
        const ville = await resoudreVilleImport(hub.id, nom);
        if (ville.cree) creees += 1;
        if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);

        await prisma.tarifPrestataireVille.upsert({
          where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: ville.id } },
          update: { tarifLivraison: zone.tarif },
          create: { prestataireId: prestataire.id, villeId: ville.id, tarifLivraison: zone.tarif },
        });
        tarifs += 1;
      }
      console.log(`   zone ${zone.tarif} dh : ${zone.villes.length} villes`);
    }
  }

  console.log(`\nTerminé — ${creees} villes créées, ${tarifs} tarifs ${prestataire.nom} en base.`);
  console.log("Aucun tarif de retour : le fichier source n'en donne pas.");
}

if (lanceDirectement('import-prestataire-leader-colis')) {
  lancerEnCli(importerLeaderColis);
}
