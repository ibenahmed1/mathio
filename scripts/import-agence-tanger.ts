import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resoudreHubImport, resoudreVilleImport } from '../lib/prestataires';

/**
 * Import de l'Agence Tanger (§ /admin/hubs), exécutable via
 * `npx tsx scripts/import-agence-tanger.ts`.
 *
 * Quatrième zone sous-traitée, après le Centre (Power Delivery), le Nord-Est
 * (Meta Livraison) et le Sud (Sahario Express) : celle-ci couvre le Nord-Ouest,
 * de Tanger à Chefchaouen. Idempotent et non destructif, comme les autres.
 *
 * Cas particulier de « Tanger » : la ville existait déjà, rattachée au HUB
 * INTERNE `Hub Tanger`. Elle est ici DÉPLACÉE vers l'agence — c'est le sens
 * même de la demande, la zone passe en sous-traitance — là où les autres
 * imports refusent tout déplacement entre réseaux. Le déplacement est donc
 * explicite et limité à cette ville, et non une règle générale du script :
 * `Hub Tanger` se retrouve sans ville, comme `Hub Marrakech` avant lui.
 */

const PRESTATAIRE = 'Amir Livraison';

const HUB = 'Agence Tanger';
const VILLE_HUB = 'Tanger';

type Zone = { tarif: number; villes: string[] };

const ZONES: Zone[] = [
  { tarif: 20, villes: ['Tanger'] },
  {
    tarif: 25,
    villes: [
      'Tétouan',
      'Martil',
      'Fnideq',
      "M'diq",
      'Ksar El Seghir',
      'Ksar El Kebir',
      'Larache',
      'Asilah',
    ],
  },
  {
    tarif: 30,
    villes: [
      'Ouezzane',
      'Chefchaouen',
      'Ain Drij',
      'Zoumi',
      'Bab Taza',
      'Bab Berred',
      'Oued Laou',
      'El Jebha',
    ],
  },
];

async function main() {
  const prestataire = await prisma.prestataire.upsert({
    where: { nom: PRESTATAIRE },
    update: {},
    create: { nom: PRESTATAIRE },
  });

  const hub = await resoudreHubImport({ prestataireId: prestataire.id, ville: VILLE_HUB, nom: HUB });
  if (hub.renommeDepuis) console.log(`Hub renommé : "${hub.renommeDepuis}" → "${hub.nom}"`);
  console.log(`${hub.nom} — agence ${prestataire.nom}`);

  let creees = 0;
  let tarifs = 0;

  for (const zone of ZONES) {
    for (const nom of zone.villes) {
      // Recherche DANS CETTE AGENCE (§ @@unique([hubId, nom]) sur Ville). Le
      // déplacement de « Tanger » depuis l'ancien Hub Tanger interne a été fait
      // une fois, à la reprise de la zone en sous-traitance ; il n'a plus lieu
      // d'être ici, et une ville homonyme chez un autre réseau n'est plus un
      // conflit — chaque prestataire tient sa propre liste.
      const ville = await resoudreVilleImport(hub.id, nom);
      const villeId = ville.id;
      if (ville.cree) creees += 1;
      if (ville.renommeeDepuis) console.log(`   ⤷ "${ville.renommeeDepuis}" → "${nom}"`);

      await prisma.tarifPrestataireVille.upsert({
        where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId } },
        update: { tarifLivraison: zone.tarif },
        create: { prestataireId: prestataire.id, villeId, tarifLivraison: zone.tarif },
      });
      tarifs += 1;
    }
    console.log(`   zone ${zone.tarif} dh : ${zone.villes.length} villes`);
  }

  console.log(`\nTerminé — ${creees} villes créées, ${tarifs} tarifs en base.`);
  console.log("Aucun tarif de retour : la grille source n'en donne pas.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
