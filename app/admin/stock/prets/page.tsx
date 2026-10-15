'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, Printer, ScanLine, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonDePreparation, Commande } from '@/lib/types';
import { Button } from '@/components/admin/Button';
import { ColisActionsMenu } from '@/components/admin/ColisActionsMenu';
import { BadgePlateforme, OPTIONS_ORIGINE } from '@/components/admin/BadgePlateforme';
import { suitCircuitShipeh } from '@/lib/circuit-shipeh';
import { QrScanner } from '@/components/QrScanner';
import { lireDouchette } from '@/lib/douchette';
import { CodeColis } from '@/components/colis/CodeColis';
import { annoncerEchec, annoncerSucces } from '@/lib/annonces';

// § Gestion de stock (2/4) : colis stock au statut "pret_pour_preparation",
// pas encore rattachés à un Bon de Préparation. Sélection multiple (toutes
// marchands confondus) -> POST /api/bons-preparation regroupe automatiquement
// par marchand et génère un bon par marchand représenté dans la sélection.
//
// § Circuit Shipeh (12/10/2026) : les colis Shipeh ne se regroupent pas, ils
// se SCANNENT (champ en haut de page) et passent « Reçu au hub » central.
export default function AdminStockPretsPage() {
  const [colis, setColis] = useState<Commande[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // § Plateformes partenaires : isoler les colis Shipeh, ou les autres.
  const [origine, setOrigine] = useState('');
  const [bonsGeneres, setBonsGeneres] = useState<BonDePreparation[] | null>(null);

  async function load() {
    setChargement(true);
    setError(null);
    try {
      const res = await apiGet<{ data: Commande[] }>(
        `/api/commandes?statut=pret_pour_preparation&enStock=true&sansBonPreparation=true&pageSize=100${origine ? `&origine=${origine}` : ''}`
      );
      setColis(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origine]);

  const estShipeh = (c: Commande) => suitCircuitShipeh({ source: c.source ?? 'manuel', enStock: c.enStock });
  const tousSelectionnes = colis.length > 0 && colis.every((c) => selected.has(c.id));
  // Les colis Shipeh se scannent : ils n'entrent pas dans un bon de préparation.
  const shipehSelectionnes = colis.filter((c) => selected.has(c.id) && estShipeh(c)).length;

  function toggleTout() {
    setSelected(tousSelectionnes ? new Set() : new Set(colis.map((c) => c.id)));
  }

  function toggleUn(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const marchandsConcernes = new Set(colis.filter((c) => selected.has(c.id)).map((c) => c.marchandId)).size;

  async function genererBonsPreparation() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: BonDePreparation[] }>('/api/bons-preparation', { colisIds: Array.from(selected) });
      setBonsGeneres(res.data);
      annoncerSucces(`${res.data.length} bon${res.data.length > 1 ? 's' : ''} de préparation généré${res.data.length > 1 ? 's' : ''}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      annoncerEchec(err, { prefixe: 'Bons de préparation' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Prêts pour préparation</h1>
      <p className="text-sm opacity-70">
        Colis stock prêts à être préparés. Sélectionnez les colis à regrouper : un Bon de Préparation est généré par
        marchand représenté dans la sélection.
      </p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <ScanColisShipeh onScanne={load} />

      <select className="input-basic w-fit" value={origine} onChange={(e) => setOrigine(e.target.value)}>
        {OPTIONS_ORIGINE.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" checked={tousSelectionnes} onChange={toggleTout} aria-label="Tout sélectionner" />
                </th>
                <th>Code suivi</th>
                <th>Marchand</th>
                <th>Produit</th>
                <th>Quantité</th>
                <th>Ville</th>
                <th>Date de création</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {colis.map((c) => (
                <tr key={c.id} className={selected.has(c.id) ? 'bg-brand/10' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleUn(c.id)}
                      aria-label={`Sélectionner ${c.codeSuivi}`}
                    />
                  </td>
                  <td className="font-mono text-xs font-semibold">
                    <CodeColis id={c.id} code={c.codeSuivi} />
                    <BadgePlateforme commande={c} />
                  </td>
                  <td>{c.marchand?.nomBoutique ?? '—'}</td>
                  <td>{c.produit?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                  <td>{c.quantite}</td>
                  <td>{c.ville}</td>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                  <td>
                    <ColisActionsMenu commande={c} onChanged={load} />
                  </td>
                </tr>
              ))}
              {!chargement && colis.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <ClipboardList className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun colis prêt pour préparation pour le moment</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-black/10 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">
            {selected.size > 0
              ? `${selected.size} colis sélectionné${selected.size > 1 ? 's' : ''} — ${marchandsConcernes} marchand${marchandsConcernes > 1 ? 's' : ''} (${marchandsConcernes > 1 ? `${marchandsConcernes} bons seront générés` : '1 bon sera généré'})`
              : 'Sélectionnez au moins un colis pour continuer'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {shipehSelectionnes > 0 && (
              <span className="text-xs opacity-70">Colis Shipeh : imprimer l&apos;étiquette, puis scanner (pas de bon de préparation)</span>
            )}
            <Button
              variant="secondary"
              onClick={() => window.open(`/etiquettes?ids=${Array.from(selected).join(',')}`, '_blank')}
              disabled={selected.size === 0}
              icon={<Printer className="h-4 w-4" />}
            >
              Imprimer les étiquettes
            </Button>
            <Button
              onClick={genererBonsPreparation}
              disabled={busy || selected.size === 0 || shipehSelectionnes > 0}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {busy ? 'Génération…' : 'Générer Bon de Préparation'}
            </Button>
          </div>
        </div>
      </div>

      {bonsGeneres && <ModalBonsGeneres bons={bonsGeneres} onFermer={() => setBonsGeneres(null)} />}
    </div>
  );
}

function ModalBonsGeneres({ bons, onFermer }: { bons: BonDePreparation[]; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-black">
        <div className="flex items-start justify-between">
          <p className="text-lg font-bold">
            {bons.length} Bon{bons.length > 1 ? 's' : ''} de Préparation généré{bons.length > 1 ? 's' : ''}
          </p>
          <button onClick={onFermer} className="rounded p-1 opacity-60 hover:opacity-100" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {bons.map((b) => (
            <Link
              key={b.id}
              href={`/admin/stock/bons-preparation/${b.id}`}
              className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            >
              <span className="font-mono font-semibold">{b.numero}</span>
              <span className="opacity-60">{b.nbColis} colis</span>
            </Link>
          ))}
        </div>
        <button onClick={onFermer} className="mt-4 w-full text-center text-sm font-semibold opacity-60 hover:opacity-100">
          Fermer
        </button>
      </div>
    </div>
  );
}

// § Circuit Shipeh : douchette (saisie clavier + Entrée) ou saisie manuelle du
// code. Chaque scan réussi fait passer le colis « Reçu au hub » central et le
// retire de cette liste.
function ScanColisShipeh({ onScanne }: { onScanne: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  // Caméra du téléphone (https requis : tunnel ngrok) — même composant que le
  // scan de réception au quai.
  const [camera, setCamera] = useState(false);

  async function scanner(e: React.FormEvent) {
    e.preventDefault();
    const lecture = lireDouchette(code);
    if (lecture.etat === 'complet') await envoyer(lecture.code);
  }

  async function envoyer(brut: string) {
    if (!brut || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ codeSuivi: string; dejaScanne: boolean; hub: { nom: string; ville: string } }>(
        '/api/stock/scan-reception',
        brut.includes('.') ? { qrPayload: brut } : { codeSuivi: brut }
      );
      const texte = res.dejaScanne
        ? `${res.codeSuivi} était déjà reçu au ${res.hub.nom}`
        : `${res.codeSuivi} — reçu au hub ${res.hub.ville}`;
      setMessage({ ok: true, texte });
      annoncerSucces(texte, { son: true });
      onScanne();
    } catch (err) {
      setMessage({ ok: false, texte: err instanceof Error ? err.message : 'Erreur' });
      annoncerEchec(err, { son: true, prefixe: `Scan ${brut}` });
    } finally {
      setCode('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={scanner} className="card-tint-strong flex flex-col gap-2 p-4">
      <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="scan-shipeh">
        <ScanLine className="h-4 w-4" /> Scanner un colis Shipeh (passe « Reçu au hub » Casablanca)
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="scan-shipeh"
          className="input-basic w-full max-w-xs font-mono"
          value={code}
          onChange={(e) => {
            // QR complet malgré l'Entrée prématuré de la douchette : envoyé tout de suite.
            const lecture = lireDouchette(e.target.value);
            if (lecture.etat === 'complet' && lecture.qr) envoyer(lecture.code);
            else setCode(e.target.value);
          }}
          placeholder="PD-000000"
          autoComplete="off"
          autoFocus
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Scan…' : 'Valider'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setCamera((v) => !v)} icon={<ScanLine className="h-4 w-4" />}>
          {camera ? 'Fermer la caméra' : 'Scanner avec la caméra'}
        </Button>
      </div>
      {camera && <QrScanner active={camera} onScan={(raw) => envoyer(raw.trim())} disabled={busy} sansDouchette />}
      {message && (
        <p className={`text-sm font-medium ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>{message.texte}</p>
      )}
    </form>
  );
}
