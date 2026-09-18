import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { geoArea, geoBounds } from 'd3';
import { merge } from 'topojson-client';
import type { Feature, MultiPolygon as GeoMultiPolygon } from 'geojson';
import type { GeometryCollection, MultiPolygon, Polygon, Topology } from 'topojson-specification';

/**
 * Génère components/admin/carte-maroc.json, la silhouette dessinée par la
 * carte de l'accueil admin (§ components/admin/DashboardAccueil.tsx).
 *
 *   npx tsx scripts/generer-carte-maroc.ts
 *
 * À ne relancer que pour changer de source ou de résolution : le fichier
 * produit est versionné, l'application ne télécharge rien.
 *
 * POURQUOI UN FICHIER GÉNÉRÉ PLUTÔT QU'UN ATLAS CHARGÉ À LA VOLÉE
 *
 * La carte téléchargeait l'atlas du monde entier depuis jsDelivr à chaque
 * affichage de l'accueil : plus de 100 Ko pour n'en montrer qu'un pays, et une
 * carte vide dès que le CDN est lent ou filtré (réseau d'entreprise, poste de
 * hub mal connecté). La silhouette est désormais embarquée.
 *
 * LE TERRITOIRE
 *
 * L'atlas source (Natural Earth, via world-atlas) découpe le Maroc en deux
 * entités : 504 « Morocco » et 732 « W. Sahara ». Le tableau de bord représente
 * le Royaume dans son intégralité, provinces du Sud comprises : les deux
 * géométries sont FUSIONNÉES (topojson merge), ce qui efface la ligne
 * intérieure et donne une silhouette d'un seul tenant.
 *
 * LA RÉSOLUTION
 *
 * 50m et non 110m : zoomée sur un seul pays, la 110m dessinait des côtes en
 * ligne brisée. Les coordonnées sont arrondies au millième de degré (~110 m au
 * sol), en deçà de la précision de la source : rien de visible n'est perdu, et
 * le fichier fond de moitié.
 */

// Version figée : un atlas mis à jour en amont ne doit pas changer la carte
// sans qu'on relance ce script à dessein.
const SOURCE = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const IDS_TERRITOIRE = ['504', '732'];
const DECIMALES = 3;
const CIBLE = path.join(process.cwd(), 'components', 'admin', 'carte-maroc.json');

function arrondir<T>(valeur: T): T {
  if (typeof valeur === 'number') return Number(valeur.toFixed(DECIMALES)) as T;
  if (Array.isArray(valeur)) return valeur.map(arrondir) as T;
  return valeur;
}

async function main(): Promise<void> {
  const reponse = await fetch(SOURCE);
  if (!reponse.ok) {
    throw new Error(`Atlas introuvable (HTTP ${reponse.status}) : ${SOURCE}`);
  }
  const atlas = (await reponse.json()) as Topology<{ countries: GeometryCollection }>;

  const geometries = atlas.objects.countries.geometries.filter((g) => IDS_TERRITOIRE.includes(String(g.id)));
  if (geometries.length !== IDS_TERRITOIRE.length) {
    throw new Error(
      `Attendu ${IDS_TERRITOIRE.length} géométries (${IDS_TERRITOIRE.join(', ')}), trouvé ${geometries.length} : l'atlas a changé de découpage.`
    );
  }

  const silhouette = merge(atlas, geometries as Array<Polygon | MultiPolygon>);
  const carte: Feature<GeoMultiPolygon, { nom: string }> = {
    type: 'Feature',
    properties: { nom: 'Maroc' },
    geometry: { type: 'MultiPolygon', coordinates: arrondir(silhouette.coordinates) },
  };

  // Garde-fou d'orientation. d3 déduit l'intérieur d'un anneau de son sens de
  // parcours : un anneau inversé ferait remplir le globe entier MOINS le Maroc,
  // et la carte afficherait un aplat plein sans erreur. Le Maroc couvre environ
  // 0,02 stéradian ; plus d'une demi-sphère ne peut être qu'un anneau retourné.
  const aire = geoArea(carte);
  if (aire > 2 * Math.PI) {
    throw new Error(`Aire de ${aire.toFixed(3)} sr : anneaux inversés, la carte serait fausse.`);
  }

  const [[ouest, sud], [est, nord]] = geoBounds(carte);
  const points = carte.geometry.coordinates.flat(2).length;

  writeFileSync(CIBLE, `${JSON.stringify(carte)}\n`);
  console.log(
    `${path.relative(process.cwd(), CIBLE)} : ${carte.geometry.coordinates.length} polygone(s), ${points} points, ` +
      `emprise ${ouest.toFixed(2)}° à ${est.toFixed(2)}° E, ${sud.toFixed(2)}° à ${nord.toFixed(2)}° N, aire ${aire.toFixed(4)} sr.`
  );
}

main().catch((erreur) => {
  console.error(erreur);
  process.exitCode = 1;
});
