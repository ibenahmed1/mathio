import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../lib/prisma';
import { lanceDirectement, lancerEnCli } from './cli-etape';

/**
 * Photo du référentiel des villes — l'état EXACT attendu en production.
 *
 *   npx tsx scripts/referentiel-villes-photo.ts            (prend la photo de la base courante)
 *
 * Écrit `scripts/referentiel-villes-photo.json` : les hubs (nom, ville,
 * transporteur, central ou non), chaque ville avec son hub, son numéro (d'où
 * son code partenaire V001…) et ses tarifs
 * d'achat (livraison, retour) par transporteur. C'est la référence que
 * `scripts/deployer-referentiel-villes.ts` impose à la production et contre
 * laquelle il se contrôle.
 *
 * Prise le 10/10/2026 sur la base de développement, validée ce jour-là
 * (500 villes, 11 hubs régionaux + Hub Central). À reprendre — et à
 * recommiter — chaque fois que le référentiel validé change.
 *
 * Les hubs de test (« Hub Audit Tournée… ») n'y figurent pas : ce sont des
 * données d'audit, absentes de la production (cf. lib/plateforme-villes.ts).
 */

export const CHEMIN_PHOTO = join(__dirname, 'referentiel-villes-photo.json');
export const PREFIXE_HUB_DE_TEST = 'Hub Audit Tournée';

export interface TarifPhoto {
  prestataire: string;
  livraison: number;
  retour: number | null;
}
export interface VillePhoto {
  hub: string;
  nom: string;
  // Ville.numero : le code partenaire est « V » + ce numéro (lib/ville-code.ts).
  numero: number;
  tarifs: TarifPhoto[];
}
export interface HubPhoto {
  nom: string;
  ville: string;
  isCentral: boolean;
  prestataire: string | null;
}
export interface Photo {
  prise: string;
  hubs: HubPhoto[];
  villes: VillePhoto[];
}

type Lecteur = Pick<typeof prisma, 'hub' | 'ville'>;

// État du référentiel tel que le voit `db`, dans la forme de la photo et dans
// un ordre stable (pour que deux photos d'un même état soient identiques).
export async function lireReferentiel(db: Lecteur = prisma): Promise<Omit<Photo, 'prise'>> {
  const hubs = await db.hub.findMany({
    where: { NOT: { nom: { startsWith: PREFIXE_HUB_DE_TEST } } },
    select: { nom: true, ville: true, isCentral: true, prestataire: { select: { nom: true } } },
  });
  const villes = await db.ville.findMany({
    where: { hub: { NOT: { nom: { startsWith: PREFIXE_HUB_DE_TEST } } } },
    select: {
      nom: true,
      numero: true,
      hub: { select: { nom: true } },
      tarifsPrestataires: {
        select: { tarifLivraison: true, tarifRetour: true, prestataire: { select: { nom: true } } },
      },
    },
  });
  const ordre = (a: string, b: string) => a.localeCompare(b, 'fr');
  return {
    hubs: hubs
      .map((h) => ({ nom: h.nom, ville: h.ville, isCentral: h.isCentral, prestataire: h.prestataire?.nom ?? null }))
      .sort((a, b) => ordre(a.nom, b.nom)),
    villes: villes
      .map((v) => ({
        hub: v.hub.nom,
        nom: v.nom,
        numero: v.numero,
        tarifs: v.tarifsPrestataires
          .map((t) => ({
            prestataire: t.prestataire.nom,
            livraison: Number(t.tarifLivraison),
            retour: t.tarifRetour === null ? null : Number(t.tarifRetour),
          }))
          .sort((a, b) => ordre(a.prestataire, b.prestataire)),
      }))
      .sort((a, b) => ordre(a.hub, b.hub) || ordre(a.nom, b.nom)),
  };
}

export function lirePhoto(): Photo {
  return JSON.parse(readFileSync(CHEMIN_PHOTO, 'utf8')) as Photo;
}

async function photographier(): Promise<void> {
  const etat = await lireReferentiel();
  const photo: Photo = { prise: new Date().toISOString().slice(0, 10), ...etat };
  writeFileSync(CHEMIN_PHOTO, `${JSON.stringify(photo, null, 2)}\n`, 'utf8');
  console.log(`Photo écrite : ${CHEMIN_PHOTO}`);
  console.log(`  ${photo.hubs.length} hubs, ${photo.villes.length} villes`);
}

if (lanceDirectement('referentiel-villes-photo')) {
  lancerEnCli(photographier);
}
