import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma';

/**
 * Export des grilles telles qu'elles sont EN BASE — `npx tsx
 * scripts/exporter-grilles-prestataires.ts`.
 *
 * C'est le seul contrôle de conformité qui ferme vraiment la boucle. Un audit
 * écrit par celui qui a fait l'import compare sa transcription à elle-même :
 * une erreur de lecture du document d'origine s'y reproduit à l'identique des
 * deux côtés, et passe inaperçue. Ici, la base est recrachée au format tableur
 * pour être posée À CÔTÉ du fichier reçu, et lue par quelqu'un qui a l'original
 * sous les yeux.
 *
 * Un fichier CSV par prestataire, plus un récapitulatif. Séparateur « ; » et
 * BOM UTF-8 : c'est ce qu'Excel ouvre correctement en français sans passer par
 * l'assistant d'importation.
 */

const DOSSIER = path.join(process.cwd(), 'exports-grilles');

// Excel coupe les colonnes sur « ; » en locale française. Les guillemets sont
// doublés et le champ encadré dès qu'il contient un séparateur ou un retour.
function champ(valeur: string): string {
  return /[;"\n]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;
}

function versCsv(entetes: string[], lignes: string[][]): string {
  // ﻿ : sans ce BOM, Excel lit l'UTF-8 comme de l'ANSI et « Meknès »
  // devient « MeknÃ¨s ».
  return '﻿' + [entetes, ...lignes].map((l) => l.map(champ).join(';')).join('\r\n') + '\r\n';
}

const nomFichier = (nom: string) =>
  nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();

async function main() {
  await mkdir(DOSSIER, { recursive: true });

  const prestataires = await prisma.prestataire.findMany({
    orderBy: { nom: 'asc' },
    include: {
      agences: {
        orderBy: { nom: 'asc' },
        include: { villes: { orderBy: { nom: 'asc' } } },
      },
      tarifs: { select: { villeId: true, tarifLivraison: true, tarifRetour: true } },
    },
  });

  const recap: string[][] = [];

  for (const p of prestataires) {
    const parVille = new Map(p.tarifs.map((t) => [t.villeId, t]));
    const lignes: string[][] = [];

    for (const agence of p.agences) {
      for (const ville of agence.villes) {
        const t = parVille.get(ville.id);
        lignes.push([
          agence.nom,
          ville.nom,
          t ? String(Number(t.tarifLivraison)) : '',
          t?.tarifRetour == null ? '' : String(Number(t.tarifRetour)),
        ]);
      }
    }

    const fichier = path.join(DOSSIER, `${nomFichier(p.nom)}.csv`);
    await writeFile(
      fichier,
      versCsv(['Agence', 'Ville', 'Livraison (DH)', 'Retour (DH)'], lignes),
      'utf8'
    );

    const sansTarif = lignes.filter((l) => l[2] === '').length;
    console.log(
      `${p.nom.padEnd(18)} ${String(lignes.length).padStart(3)} lignes` +
        (sansTarif > 0 ? `  (${sansTarif} sans tarif)` : '') +
        `  → ${path.relative(process.cwd(), fichier)}`
    );
    recap.push([p.nom, String(p.agences.length), String(lignes.length), String(lignes.length - sansTarif)]);
  }

  // Les hubs internes ne relèvent d'aucun prestataire mais font partie du
  // référentiel : les omettre donnerait un export incomplet.
  const internes = await prisma.hub.findMany({
    where: { prestataireId: null },
    orderBy: { nom: 'asc' },
    include: { villes: { orderBy: { nom: 'asc' } } },
  });
  const lignesInternes = internes.flatMap((h) => h.villes.map((v) => [h.nom, v.nom]));
  await writeFile(
    path.join(DOSSIER, 'hubs-internes.csv'),
    versCsv(['Hub interne', 'Ville'], lignesInternes),
    'utf8'
  );
  console.log(`${'Hubs internes'.padEnd(18)} ${String(lignesInternes.length).padStart(3)} lignes  → exports-grilles/hubs-internes.csv`);

  await writeFile(
    path.join(DOSSIER, 'recapitulatif.csv'),
    versCsv(['Prestataire', 'Agences', 'Villes', 'Villes tarifées'], recap),
    'utf8'
  );

  console.log(`\nDossier : ${DOSSIER}`);
  console.log('Ouvrez chaque CSV à côté du fichier reçu du transporteur : ligne à ligne, c\'est le seul contrôle qui vaut.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
