'use client';

import { useEffect, useState } from 'react';
import { UploadCloud, CheckCircle2, XCircle, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Marchandise } from '@/lib/types';

const COLONNES_ATTENDUES = [
  'clientNom',
  'clientTelephone',
  'marchandise',
  'quantite',
  'ville',
  'adresse',
  'montantCod',
  'notes',
  'colisARemplacerCode',
  'ouvrir',
  'fragile',
  'aRemplacer',
  'enStock',
];

const COLONNES_REQUISES = ['clientNom', 'clientTelephone', 'ville', 'adresse', 'montantCod'];

interface LigneColis {
  clientNom: string;
  clientTelephone: string;
  marchandise: string;
  quantite: string;
  ville: string;
  adresse: string;
  montantCod: string;
  notes: string;
  colisARemplacerCode: string;
  ouvrir: string;
  fragile: string;
  aRemplacer: string;
  enStock: string;
}

function parseCsv(text: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let dansGuillemets = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (dansGuillemets) {
      if (c === '"' && text[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') {
        dansGuillemets = false;
      } else {
        champ += c;
      }
    } else if (c === '"') {
      dansGuillemets = true;
    } else if (c === ',') {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
    } else {
      champ += c;
    }
  }
  if (champ !== '' || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((v) => v.trim() !== ''));
}

function rowsFromEntetes(rows: string[][]): { lignes: LigneColis[]; error: string | null } {
  if (rows.length < 2) {
    return { lignes: [], error: 'Le fichier doit contenir un en-tête et au moins une ligne de données.' };
  }
  const entetes = rows[0].map((h) => String(h ?? '').trim());
  const manquantes = COLONNES_REQUISES.filter((c) => !entetes.includes(c));
  if (manquantes.length > 0) {
    return { lignes: [], error: `Colonnes manquantes dans l'en-tête : ${manquantes.join(', ')}` };
  }
  const parsed = rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    entetes.forEach((h, i) => (obj[h] = String(row[i] ?? '').trim()));
    return obj as unknown as LigneColis;
  });
  return { lignes: parsed, error: null };
}

function boolFromCell(v: string): boolean {
  return ['1', 'true', 'vrai', 'oui', 'x'].includes(v.trim().toLowerCase());
}

export default function ImportColisPage() {
  const [lignes, setLignes] = useState<LigneColis[]>([]);
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ succes: number; echecs: number } | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    apiGet<{ data: Marchandise[] }>('/api/marchandises')
      .then((res) => setMarchandises(res.data))
      .catch(() => {});
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResultat(null);

    const estExcel = /\.xlsx?$/i.test(file.name);
    let rows: string[][];

    if (estExcel) {
      const buffer = await file.arrayBuffer();
      const classeur = XLSX.read(buffer, { type: 'array' });
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<string[]>(feuille, { header: 1, raw: false, defval: '' });
    } else {
      const text = await file.text();
      rows = parseCsv(text);
    }

    const { lignes: parsed, error: err } = rowsFromEntetes(rows);
    if (err) {
      setError(err);
      setLignes([]);
      return;
    }
    setLignes(parsed);
  }

  async function handleImport() {
    setEnvoiEnCours(true);
    setResultat(null);
    let succes = 0;
    let echecs = 0;
    for (const ligne of lignes) {
      try {
        const marchandise = ligne.marchandise
          ? marchandises.find((m) => m.nom.toLowerCase() === ligne.marchandise.trim().toLowerCase())
          : undefined;
        await apiPost('/api/commandes', {
          clientNom: ligne.clientNom,
          clientTelephone: ligne.clientTelephone,
          marchandiseId: marchandise?.id,
          produitDescription: !marchandise && ligne.marchandise ? ligne.marchandise : undefined,
          quantite: ligne.quantite ? Number(ligne.quantite) : undefined,
          ville: ligne.ville,
          adresse: ligne.adresse,
          montantCod: ligne.montantCod ? Number(ligne.montantCod) : undefined,
          notes: ligne.notes || undefined,
          colisARemplacerCode: ligne.colisARemplacerCode || undefined,
          ouvrir: ligne.ouvrir ? boolFromCell(ligne.ouvrir) : undefined,
          fragile: ligne.fragile ? boolFromCell(ligne.fragile) : undefined,
          aRemplacer: ligne.aRemplacer ? boolFromCell(ligne.aRemplacer) : undefined,
          enStock: ligne.enStock ? boolFromCell(ligne.enStock) : undefined,
        });
        succes++;
      } catch {
        echecs++;
      }
    }
    setResultat({ succes, echecs });
    setEnvoiEnCours(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Import de colis</h1>

      <p className="max-w-2xl text-sm opacity-70">
        Fichier CSV ou Excel (.xlsx) avec les colonnes :{' '}
        <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-xs dark:bg-white/10">
          {COLONNES_ATTENDUES.join(', ')}
        </code>
        . Seules{' '}
        <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-xs dark:bg-white/10">
          {COLONNES_REQUISES.join(', ')}
        </code>{' '}
        sont obligatoires. La colonne <code className="font-mono">marchandise</code>{' '}
        doit reprendre le nom exact d&apos;une marchandise déjà enregistrée dans votre catalogue — son prix
        pré-remplira alors automatiquement le montant si la colonne{' '}
        <code className="font-mono">montantCod</code> est laissée vide.
      </p>

      <label className="flex w-fit cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-black/20 bg-black/[0.015] px-6 py-5 text-sm font-semibold transition hover:border-brand hover:bg-brand/5 dark:border-white/20 dark:bg-white/[0.02]">
        <FileSpreadsheet className="h-6 w-6 opacity-60" />
        <span className="flex flex-col">
          {fileName || 'Choisir un fichier CSV ou Excel…'}
          <span className="text-xs font-normal opacity-50">.csv, .xlsx ou .xls</span>
        </span>
        <input
          type="file"
          accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={handleFile}
        />
      </label>

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <XCircle className="h-4 w-4" /> {error}
        </p>
      )}

      {lignes.length > 0 && (
        <>
          <div className="table-card">
            <div className="max-h-[420px] overflow-auto">
              <table className="table-basic min-w-[1100px]">
                <thead className="sticky top-0">
                  <tr>
                    <th className="text-right">#</th>
                    {COLONNES_ATTENDUES.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.slice(0, 20).map((l, i) => (
                    <tr key={i}>
                      <td className="text-right text-xs opacity-40">{i + 1}</td>
                      <td>{l.clientNom}</td>
                      <td>{l.clientTelephone}</td>
                      <td>{l.marchandise}</td>
                      <td>{l.quantite}</td>
                      <td>{l.ville}</td>
                      <td>{l.adresse}</td>
                      <td>{l.montantCod}</td>
                      <td>{l.notes}</td>
                      <td>{l.colisARemplacerCode}</td>
                      <td>{l.ouvrir}</td>
                      <td>{l.fragile}</td>
                      <td>{l.aRemplacer}</td>
                      <td>{l.enStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs opacity-60">
            {lignes.length} ligne(s) détectée(s){lignes.length > 20 ? ' (aperçu limité à 20)' : ''}.
          </p>

          <button onClick={handleImport} disabled={envoiEnCours} className="btn-primary flex w-fit items-center gap-2">
            <UploadCloud className="h-4 w-4" />
            {envoiEnCours ? 'Import en cours…' : `Importer ${lignes.length} colis`}
          </button>
        </>
      )}

      {resultat && (
        <div className="flex w-fit items-center gap-4 rounded-lg border border-black/10 px-4 py-2.5 text-sm font-medium dark:border-white/10">
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {resultat.succes} importé(s)
          </span>
          {resultat.echecs > 0 && (
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" /> {resultat.echecs} échec(s)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
