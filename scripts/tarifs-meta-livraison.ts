import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { normaliserVille } from '../lib/hub-stock';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Tarifs d'achat Meta Livraison, exécutable via
 * `npx tsx scripts/tarifs-meta-livraison.ts`.
 *
 * Leur fichier source (« metalivraison.csv ») ne donne aucun prix, d'où un
 * import sans tarif (scripts/import-prestataire-meta-livraison.ts, qui reste une
 * transcription fidèle du fichier). Les prix ont été fixés à part, le
 * 01/10/2026 : 18 dh pour Fès, 28 dh pour toutes les autres villes.
 *
 * Étape distincte, et non ajoutée à l'import, pour deux raisons :
 *   · « Fès » n'est pas dans leur fichier — c'est une ville d'implantation,
 *     ajoutée par scripts/ajouter-villes-agences.ts, qui passe APRÈS les
 *     imports dans scripts/charger-referentiel.ts ;
 *   · la règle porte sur TOUTES les villes de leurs agences, y compris celles
 *     saisies depuis /admin/hubs : elle se lit donc en base, pas dans un fichier.
 *
 * Idempotent : relancé, il réaligne les prix sur la règle (une correction faite
 * depuis /admin/prestataires est écrasée, comme pour les autres imports). Aucun
 * tarif de retour : la règle n'en donne pas.
 */

const PRESTATAIRE = 'Meta Livraison';
const TARIF_FES = 18;
const TARIF_AUTRES = 28;

export function tarifMeta(ville: string): number {
  return normaliserVille(ville) === 'fes' ? TARIF_FES : TARIF_AUTRES;
}

export async function appliquerTarifsMetaLivraison(): Promise<void> {
  const prestataire = await prisma.prestataire.findUnique({ where: { nom: PRESTATAIRE }, select: { id: true } });
  if (!prestataire) {
    console.log(`Prestataire « ${PRESTATAIRE} » absent : rien à tarifer.`);
    return;
  }

  const villes = await prisma.ville.findMany({
    where: { hub: { prestataireId: prestataire.id } },
    select: { id: true, nom: true, hub: { select: { nom: true } } },
    orderBy: [{ hub: { nom: 'asc' } }, { nom: 'asc' }],
  });

  const parTarif = new Map<number, string[]>();
  for (const ville of villes) {
    const tarif = tarifMeta(ville.nom);
    await prisma.tarifPrestataireVille.upsert({
      where: { prestataireId_villeId: { prestataireId: prestataire.id, villeId: ville.id } },
      update: { tarifLivraison: tarif },
      create: { prestataireId: prestataire.id, villeId: ville.id, tarifLivraison: tarif },
    });
    parTarif.set(tarif, [...(parTarif.get(tarif) ?? []), `${ville.nom} (${ville.hub.nom})`]);
  }

  console.log(`${villes.length} villes ${PRESTATAIRE} tarifées.`);
  for (const [tarif, noms] of [...parTarif].sort(([a], [b]) => a - b)) {
    console.log(`   ${tarif} dh : ${noms.length} ville(s)${noms.length <= 5 ? ` — ${noms.join(', ')}` : ''}`);
  }
  if (!parTarif.has(TARIF_FES)) console.log('   ⚠ Aucune ville « Fès » trouvée : lancer d’abord scripts/ajouter-villes-agences.ts');
}

if (lanceDirectement('tarifs-meta-livraison')) {
  lancerEnCli(appliquerTarifsMetaLivraison);
}
