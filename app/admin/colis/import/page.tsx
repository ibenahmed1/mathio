'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, UploadCloud, CheckCircle2, XCircle, AlertTriangle, UserPlus, RefreshCw } from 'lucide-react';
import { apiGet, apiPost, ApiRequestError } from '@/lib/api-client';
import type { Marchand, Produit } from '@/lib/types';

type TypeImport = 'normal' | 'stock';

const COLONNES_REQUISES_COMMUNES = ['Identifiant Marchand', 'Nom du Destinataire', 'Téléphone', 'Ville', 'Adresse', 'Prix COD'];

// Persistance de l'état en cours (fichier parsé + corrections) le temps que
// l'admin aille créer un compte marchand manquant sur /inscription et revienne
// via returnTo — une navigation complète démonterait la page et perdrait l'état.
const CLE_STOCKAGE = 'admin-import-colis-etat';

interface LigneBrute {
  identifiantMarchand: string;
  codeSuivi: string;
  destinataire: string;
  telephone: string;
  ville: string;
  adresse: string;
  prixCod: string;
  produitOuRef: string;
  quantite: string;
  autoriseOuvrir: string;
  colisARemplacer: string;
  commentaire: string;
}

function colonneProduit(type: TypeImport) {
  return type === 'normal' ? 'Produit' : 'Ref';
}

function boolFromCell(v: string): boolean {
  return ['1', 'true', 'vrai', 'oui', 'x'].includes(v.trim().toLowerCase());
}

function parseFichier(rows: string[][], type: TypeImport): { lignes: LigneBrute[]; error: string | null } {
  if (rows.length < 2) {
    return { lignes: [], error: 'Le fichier doit contenir un en-tête et au moins une ligne de données.' };
  }
  const entetes = rows[0].map((h) => String(h ?? '').trim());
  const colProduit = colonneProduit(type);
  const requises = [...COLONNES_REQUISES_COMMUNES, colProduit];
  const manquantes = requises.filter((c) => !entetes.includes(c));
  if (manquantes.length > 0) {
    return { lignes: [], error: `Colonnes manquantes dans l'en-tête : ${manquantes.join(', ')}` };
  }

  const idx = (nom: string) => entetes.indexOf(nom);
  const cell = (row: string[], nom: string) => String(row[idx(nom)] ?? '').trim();

  const lignes = rows
    .slice(1)
    .filter((row) => row.some((v) => String(v ?? '').trim() !== ''))
    .map((row) => ({
      identifiantMarchand: cell(row, 'Identifiant Marchand'),
      codeSuivi: cell(row, 'Code Suivi'),
      destinataire: cell(row, 'Nom du Destinataire'),
      telephone: cell(row, 'Téléphone'),
      ville: cell(row, 'Ville'),
      adresse: cell(row, 'Adresse'),
      prixCod: cell(row, 'Prix COD'),
      produitOuRef: cell(row, colProduit),
      quantite: cell(row, 'Quantité'),
      autoriseOuvrir: cell(row, 'Autorisé à Ouvrir'),
      colisARemplacer: cell(row, 'Colis à Remplacer'),
      commentaire: cell(row, 'Commentaire'),
    }));

  return { lignes, error: null };
}

interface EtatLigne {
  ligne: LigneBrute;
  index: number;
  marchandId: string | null;
  refEffective: string;
  refInvalide: boolean;
  erreurs: string[];
}

type LigneAvecId = LigneBrute & { id: number };

export default function AdminImportColisPage() {
  const [type, setType] = useState<TypeImport>('normal');
  const [marchands, setMarchands] = useState<Marchand[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneAvecId[]>([]);
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const [produitsParMarchand, setProduitsParMarchand] = useState<Record<string, Produit[]>>({});
  const [chargementRefs, setChargementRefs] = useState(false);
  const [soumission, setSoumission] = useState(false);
  const [erreurSoumission, setErreurSoumission] = useState<string | null>(null);
  // Détail ligne par ligne renvoyé par le serveur (validations qui ne peuvent
  // être détectées qu'en base, ex. doublon de référence partenaire déjà
  // importée) — distinct des erreurs `etats` calculées côté client sur les
  // seules données du fichier.
  const [detailErreursServeur, setDetailErreursServeur] = useState<{ index: number; message: string }[]>([]);
  const [resultat, setResultat] = useState<{ creees: number; bonsLivraison: { numero: string; nbColis: number }[] } | null>(null);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [etatRestaure, setEtatRestaure] = useState(false);

  const chargerMarchands = useCallback(async () => {
    const res = await apiGet<{ data: Marchand[] }>('/api/marchands');
    setMarchands(res.data);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => chargerMarchands()).catch(() => {});
  }, [chargerMarchands]);

  // Restauration de l'état sauvegardé (retour depuis /inscription via returnTo).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const brut = sessionStorage.getItem(CLE_STOCKAGE);
        if (brut) {
          const sauvegarde = JSON.parse(brut) as {
            type: TypeImport;
            lignes: LigneAvecId[];
            fileName: string;
            corrections: Record<number, string>;
          };
          if (Array.isArray(sauvegarde.lignes) && sauvegarde.lignes.length > 0) {
            setType(sauvegarde.type ?? 'normal');
            setLignes(sauvegarde.lignes);
            setFileName(sauvegarde.fileName ?? '');
            setCorrections(sauvegarde.corrections ?? {});
          }
        }
      } catch {
        // ignore un état corrompu
      } finally {
        setEtatRestaure(true);
      }
    });
  }, []);

  // Sauvegarde continue de l'état une fois la restauration initiale faite,
  // pour ne pas écraser un état sauvegardé avant d'avoir pu le relire.
  useEffect(() => {
    if (!etatRestaure) return;
    try {
      if (lignes.length > 0) {
        sessionStorage.setItem(CLE_STOCKAGE, JSON.stringify({ type, lignes, fileName, corrections }));
      } else {
        sessionStorage.removeItem(CLE_STOCKAGE);
      }
    } catch {
      // stockage indisponible (navigation privée, quota…) : tant pis, pas bloquant
    }
  }, [etatRestaure, type, lignes, fileName, corrections]);

  // Index de résolution "Identifiant Marchand" -> marchandId, par email ou
  // téléphone du compte utilisateur (seuls champs uniques disponibles — pas
  // de "code marchand" en base).
  const indexMarchands = useMemo(() => {
    const parEmail = new Map<string, string>();
    const parTelephone = new Map<string, string>();
    for (const m of marchands) {
      if (m.utilisateur?.email) parEmail.set(m.utilisateur.email.trim().toLowerCase(), m.id);
      if (m.utilisateur?.telephone) parTelephone.set(m.utilisateur.telephone.trim(), m.id);
    }
    return { parEmail, parTelephone };
  }, [marchands]);

  function resoudreMarchandId(identifiant: string): string | null {
    const v = identifiant.trim();
    if (!v) return null;
    return indexMarchands.parEmail.get(v.toLowerCase()) ?? indexMarchands.parTelephone.get(v) ?? null;
  }

  // Marchands distincts résolus dans le fichier courant (mode stock) : sert à
  // savoir quels catalogues Produit charger pour valider/corriger les Ref.
  const marchandIdsStock = useMemo(() => {
    if (type !== 'stock') return [] as string[];
    const set = new Set<string>();
    for (const l of lignes) {
      const id = resoudreMarchandId(l.identifiantMarchand);
      if (id) set.add(id);
    }
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, type, marchands]);

  useEffect(() => {
    queueMicrotask(() => {
      const manquants = marchandIdsStock.filter((id) => !(id in produitsParMarchand));
      if (manquants.length === 0) return;
      setChargementRefs(true);
      Promise.all(
        manquants.map((id) =>
          apiGet<{ data: Produit[] }>(`/api/produits?marchandId=${id}`)
            .then((res) => [id, res.data] as const)
            .catch(() => [id, [] as Produit[]] as const)
        )
      ).then((paires) => {
        setProduitsParMarchand((prev) => {
          const next = { ...prev };
          for (const [id, produits] of paires) next[id] = produits;
          return next;
        });
        setChargementRefs(false);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marchandIdsStock]);

  const etats: EtatLigne[] = useMemo(() => {
    return lignes.map((ligne) => {
      const index = ligne.id;
      const marchandId = resoudreMarchandId(ligne.identifiantMarchand);
      const erreurs: string[] = [];

      if (!marchandId) {
        erreurs.push(`Marchand introuvable pour "${ligne.identifiantMarchand || '(vide)'}"`);
      }
      if (!ligne.destinataire) erreurs.push('Nom du Destinataire manquant');
      if (!ligne.telephone) erreurs.push('Téléphone manquant');
      if (!ligne.ville) erreurs.push('Ville manquante');
      if (!ligne.adresse) erreurs.push('Adresse manquante');
      const prix = Number(ligne.prixCod);
      if (!Number.isFinite(prix) || prix <= 0) erreurs.push('Prix COD invalide');
      if (ligne.quantite && (!Number.isInteger(Number(ligne.quantite)) || Number(ligne.quantite) <= 0)) {
        erreurs.push('Quantité invalide');
      }

      const refEffective = corrections[index] ?? ligne.produitOuRef;
      let refInvalide = false;
      if (!refEffective) {
        erreurs.push(type === 'normal' ? 'Produit manquant' : 'Ref manquante');
      } else if (type === 'stock' && marchandId) {
        const produits = produitsParMarchand[marchandId];
        if (produits && !produits.some((p) => p.reference === refEffective)) {
          refInvalide = true;
          erreurs.push(`Référence stock introuvable : "${refEffective}"`);
        }
      }

      return { ligne, index, marchandId, refEffective, refInvalide, erreurs };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resoudreMarchandId ne lit que indexMarchands, déjà listé
  }, [lignes, corrections, type, produitsParMarchand, indexMarchands]);

  const nbErreurs = etats.filter((e) => e.erreurs.length > 0).length;
  const nbValides = etats.length - nbErreurs;
  const pretAImporter = lignes.length > 0 && nbErreurs === 0 && !chargementRefs;
  const pretAImporterPartiel = nbValides > 0 && nbErreurs > 0 && !chargementRefs;

  // Marchands distincts introuvables (identifiant non vide) : un lien "Créer
  // le compte" par identifiant, avec le nombre de colis concernés — plutôt
  // qu'un message d'erreur répété sur chaque ligne du même client.
  const groupesMarchandsIntrouvables = useMemo(() => {
    const parIdentifiant = new Map<string, number>();
    for (const e of etats) {
      const identifiant = e.ligne.identifiantMarchand.trim();
      if (!identifiant || e.marchandId) continue;
      parIdentifiant.set(identifiant, (parIdentifiant.get(identifiant) ?? 0) + 1);
    }
    return Array.from(parIdentifiant.entries()).map(([identifiant, nbColis]) => ({ identifiant, nbColis }));
  }, [etats]);

  function lienCreationCompte(identifiant: string): string {
    const params = new URLSearchParams({ returnTo: '/admin/colis/import' });
    params.set(identifiant.includes('@') ? 'email' : 'telephone', identifiant);
    return `/inscription?${params.toString()}`;
  }

  async function rafraichirMarchands() {
    setRafraichissement(true);
    try {
      await chargerMarchands();
    } catch {
      // ignore, l'admin peut réessayer
    } finally {
      setRafraichissement(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileError(null);
    setResultat(null);
    setErreurSoumission(null);
    setCorrections({});

    const buffer = await file.arrayBuffer();
    const classeur = XLSX.read(buffer, { type: 'array' });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(feuille, { header: 1, raw: false, defval: '' });

    const { lignes: parsed, error } = parseFichier(rows, type);
    if (error) {
      setFileError(error);
      setLignes([]);
      return;
    }
    setLignes(parsed.map((l, id) => ({ ...l, id })));
  }

  function changerType(nouveau: TypeImport) {
    setType(nouveau);
    setLignes([]);
    setFileName('');
    setFileError(null);
    setCorrections({});
    setResultat(null);
    setErreurSoumission(null);
  }

  // subsetOnly : n'envoie que les lignes valides du fichier (bouton "Importer
  // uniquement les colis valides") — les lignes en erreur restent affichées,
  // en attente que l'admin crée les comptes marchand manquants.
  async function handleImport(subsetOnly: boolean) {
    const cible = subsetOnly ? etats.filter((e) => e.erreurs.length === 0) : etats;
    if (cible.length === 0) return;

    setSoumission(true);
    setErreurSoumission(null);
    setDetailErreursServeur([]);
    try {
      const payload = {
        type,
        lignes: cible.map((e) => ({
          identifiantMarchand: e.ligne.identifiantMarchand,
          codeSuiviPartenaire: e.ligne.codeSuivi,
          destinataire: e.ligne.destinataire,
          telephone: e.ligne.telephone,
          ville: e.ligne.ville,
          adresse: e.ligne.adresse,
          prixCod: Number(e.ligne.prixCod),
          produit: type === 'normal' ? e.refEffective : undefined,
          ref: type === 'stock' ? e.refEffective : undefined,
          quantite: e.ligne.quantite ? Number(e.ligne.quantite) : 1,
          autoriseOuvrir: boolFromCell(e.ligne.autoriseOuvrir),
          colisARemplacer: boolFromCell(e.ligne.colisARemplacer),
          commentaire: e.ligne.commentaire,
        })),
      };
      const res = await apiPost<{ creees: number; bonsLivraison: { numero: string; nbColis: number }[] }>(
        '/api/commandes/import',
        payload
      );

      if (subsetOnly) {
        const idsImportes = new Set(cible.map((e) => e.index));
        setLignes((prev) => prev.filter((l) => !idsImportes.has(l.id)));
        setCorrections((prev) => {
          const next = { ...prev };
          for (const id of idsImportes) delete next[id];
          return next;
        });
        setResultat((prev) =>
          prev
            ? { creees: prev.creees + res.creees, bonsLivraison: [...prev.bonsLivraison, ...res.bonsLivraison] }
            : res
        );
      } else {
        setResultat(res);
        setLignes([]);
        setFileName('');
        setCorrections({});
      }
    } catch (err) {
      setErreurSoumission(err instanceof Error ? err.message : 'Échec de l\'import');
      // Détail ligne par ligne (validations/doublons détectés côté serveur,
      // cf. POST /api/commandes/import) — ApiRequestError.details porte le
      // corps JSON complet de la réponse d'erreur.
      if (err instanceof ApiRequestError && err.details && typeof err.details === 'object') {
        const body = err.details as { erreurs?: { index: number; message: string }[]; doublons?: { index: number; message: string }[] };
        const detail = [...(body.erreurs ?? []), ...(body.doublons ?? [])].sort((a, b) => a.index - b.index);
        setDetailErreursServeur(detail);
      }
    } finally {
      setSoumission(false);
    }
  }

  const colProduit = colonneProduit(type);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Import de colis par fichier Excel</h1>

      <div className="flex w-fit rounded-lg border border-black/10 p-1 text-sm font-semibold dark:border-white/10">
        <button
          onClick={() => changerType('normal')}
          className={`rounded-md px-4 py-1.5 transition ${type === 'normal' ? 'bg-brand text-brand-foreground' : 'opacity-60 hover:opacity-100'}`}
        >
          Colis normal
        </button>
        <button
          onClick={() => changerType('stock')}
          className={`rounded-md px-4 py-1.5 transition ${type === 'stock' ? 'bg-brand text-brand-foreground' : 'opacity-60 hover:opacity-100'}`}
        >
          Colis stock / fulfillment
        </button>
      </div>

      <p className="max-w-2xl text-sm opacity-70">
        {type === 'normal' ? (
          <>
            Crée les colis et génère automatiquement un Bon de Livraison par marchand (statut : en attente de
            ramassage).
          </>
        ) : (
          <>
            La colonne <code className="font-mono">Ref</code> doit correspondre à une référence déjà enregistrée
            dans le stock du marchand. Aucun Bon de Livraison n&apos;est généré : ces colis passent d&apos;abord par
            le picking au Hub.
          </>
        )}
      </p>

      <a
        href={`/api/commandes/import/template?type=${type}`}
        className="btn-outline flex w-fit items-center gap-2"
      >
        <Download className="h-4 w-4" />
        Télécharger le modèle {type === 'normal' ? 'Colis normal' : 'Colis stock'}.xlsx
      </a>

      <label className="flex w-fit cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-black/20 bg-black/[0.015] px-6 py-5 text-sm font-semibold transition hover:border-brand hover:bg-brand/5 dark:border-white/20 dark:bg-white/[0.02]">
        <FileSpreadsheet className="h-6 w-6 opacity-60" />
        <span className="flex flex-col">
          {fileName || 'Choisir un fichier Excel…'}
          <span className="text-xs font-normal opacity-50">.xlsx ou .xls</span>
        </span>
        <input
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={handleFile}
        />
      </label>

      {fileError && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <XCircle className="h-4 w-4" /> {fileError}
        </p>
      )}

      {groupesMarchandsIntrouvables.length > 0 && (
        <div className="flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {groupesMarchandsIntrouvables.length} marchand(s) introuvable(s) —{' '}
              {groupesMarchandsIntrouvables.reduce((total, g) => total + g.nbColis, 0)} colis concerné(s)
            </p>
            <button
              type="button"
              onClick={rafraichirMarchands}
              disabled={rafraichissement}
              className="btn-outline flex items-center gap-2 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rafraichissement ? 'animate-spin' : ''}`} />
              {rafraichissement ? 'Actualisation…' : 'Rafraîchir les marchands'}
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {groupesMarchandsIntrouvables.map((g) => (
              <li
                key={g.identifiant}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/60 px-3 py-1.5 text-xs dark:bg-black/20"
              >
                <span>
                  <strong>{g.identifiant}</strong> — {g.nbColis} colis
                </span>
                <a
                  href={lienCreationCompte(g.identifiant)}
                  className="btn-outline flex items-center gap-1.5 px-2 py-1 text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Créer le compte
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-60">
            Une fois le(s) compte(s) créé(s), cliquez sur « Rafraîchir les marchands » pour re-tester la résolution
            sans recharger le fichier.
          </p>
        </div>
      )}

      {lignes.length > 0 && (
        <>
          <div className="table-card">
            <div className="max-h-[480px] overflow-auto">
              <table className="table-basic min-w-[1200px]">
                <thead className="sticky top-0">
                  <tr>
                    <th className="text-right">#</th>
                    <th>Identifiant Marchand</th>
                    <th>Destinataire</th>
                    <th>Téléphone</th>
                    <th>Ville</th>
                    <th>Adresse</th>
                    <th>Prix COD</th>
                    <th>{colProduit}</th>
                    <th>Qté</th>
                    <th>Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {etats.map((e) => (
                    <tr key={e.index} className={e.erreurs.length > 0 ? 'bg-red-500/10' : undefined}>
                      <td className="text-right text-xs opacity-40">{e.index + 1}</td>
                      <td>{e.ligne.identifiantMarchand}</td>
                      <td>{e.ligne.destinataire}</td>
                      <td>{e.ligne.telephone}</td>
                      <td>{e.ligne.ville}</td>
                      <td>{e.ligne.adresse}</td>
                      <td>{e.ligne.prixCod}</td>
                      <td>
                        {e.refInvalide && e.marchandId && produitsParMarchand[e.marchandId] ? (
                          <select
                            className="input-basic py-1 text-xs"
                            value=""
                            onChange={(ev) =>
                              setCorrections((prev) => ({ ...prev, [e.index]: ev.target.value }))
                            }
                          >
                            <option value="" disabled>
                              — corriger la référence —
                            </option>
                            {produitsParMarchand[e.marchandId].map((p) => (
                              <option key={p.id} value={p.reference}>
                                {p.reference} — {p.nom}
                              </option>
                            ))}
                          </select>
                        ) : (
                          e.refEffective
                        )}
                      </td>
                      <td>{e.ligne.quantite || '1'}</td>
                      <td className="max-w-[280px] text-xs text-red-700 dark:text-red-400">
                        {e.erreurs.length > 0 && (
                          <span className="flex items-start gap-1">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {e.erreurs.join(' · ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs opacity-60">
            {lignes.length} ligne(s) détectée(s)
            {nbErreurs > 0 ? ` — ${nbErreurs} en erreur (à corriger avant import)` : ''}
            {chargementRefs ? ' — vérification des références en cours…' : ''}
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleImport(false)}
              disabled={!pretAImporter || soumission}
              className="btn-primary flex items-center gap-2"
            >
              <UploadCloud className="h-4 w-4" />
              {soumission ? 'Import en cours…' : `Importer tout le fichier (${lignes.length})`}
            </button>
            {nbErreurs > 0 && (
              <button
                onClick={() => handleImport(true)}
                disabled={!pretAImporterPartiel || soumission}
                className="btn-outline flex items-center gap-2"
                title="Envoie uniquement les colis sans erreur ; les autres restent affichés pour correction"
              >
                <UploadCloud className="h-4 w-4" />
                {soumission ? 'Import en cours…' : `Importer uniquement les colis valides (${nbValides})`}
              </button>
            )}
          </div>
        </>
      )}

      {erreurSoumission && (
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-red-600">
            <XCircle className="h-4 w-4" /> {erreurSoumission}
          </p>
          {detailErreursServeur.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-400">
              {detailErreursServeur.map((e, i) => (
                <li key={i}>
                  Ligne {e.index + 1} — {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resultat && (
        <div className="flex w-fit flex-col gap-2 rounded-lg border border-black/10 px-4 py-3 text-sm dark:border-white/10">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {resultat.creees} colis importé(s)
          </span>
          {resultat.bonsLivraison.length > 0 && (
            <span className="text-xs opacity-70">
              Bon(s) de livraison généré(s) : {resultat.bonsLivraison.map((b) => `${b.numero} (${b.nbColis} colis)`).join(', ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
