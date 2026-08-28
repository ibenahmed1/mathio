'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PackagePlus, FileUp, FileDown, PackageSearch, DoorOpen, TriangleAlert, Search, X, CalendarRange, MapPin, Wallet, Trash2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { EtatPaiementBadge } from '@/components/EtatPaiementBadge';
import { STATUTS_COMMANDE, LABELS_STATUT_COMMANDE, ETATS_PAIEMENT, LABELS_ETAT_PAIEMENT } from '@/lib/statuts';
import { ColisActionsMenu } from '@/components/marchand/ColisActionsMenu';
import { ColisSubNav } from './ColisSubNav';

function ColisListContent() {
  const searchParams = useSearchParams();
  const statutInitial = searchParams.get('statut') ?? '';

  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [statutFiltre, setStatutFiltre] = useState(statutInitial);
  const [etatPaiementFiltre, setEtatPaiementFiltre] = useState('');
  const [villeFiltre, setVilleFiltre] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  const filtresActifs = [etatPaiementFiltre, villeFiltre, dateFrom, dateTo, search].filter(Boolean).length;

  // Resynchronise le filtre quand on navigue vers un onglet différent
  // (ex. clic sur "En attente" depuis une autre page Colis déjà montée).
  useEffect(() => {
    queueMicrotask(() => {
      setStatutFiltre(searchParams.get('statut') ?? '');
    });
  }, [searchParams]);

  // Centralise la construction des query params de filtre, partagée entre le
  // chargement de la liste et l'export Excel (mêmes filtres, même résultat).
  function buildFiltreParams(overrides?: { etatPaiement?: string; ville?: string; dateFrom?: string; dateTo?: string; search?: string }) {
    const params = new URLSearchParams();
    const etatPaiement = overrides?.etatPaiement ?? etatPaiementFiltre;
    const ville = overrides?.ville ?? villeFiltre;
    const from = overrides?.dateFrom ?? dateFrom;
    const to = overrides?.dateTo ?? dateTo;
    const q = overrides?.search ?? search;
    if (statutFiltre) params.set('statut', statutFiltre);
    if (etatPaiement) params.set('etatPaiement', etatPaiement);
    if (ville) params.set('ville', ville);
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    if (q) params.set('search', q);
    return params;
  }

  // Accepte des surcharges ponctuelles (ex. réinitialisation) : le state React
  // n'étant pas encore à jour au moment de l'appel, on ne peut pas s'y fier.
  async function load(overrides?: { etatPaiement?: string; ville?: string; dateFrom?: string; dateTo?: string; search?: string }) {
    setChargement(true);
    try {
      const params = buildFiltreParams(overrides);
      const res = await apiGet<{ data: Commande[] }>(`/api/commandes?${params.toString()}`);
      setCommandes(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  // Seuls les colis "Nouveau Colis" sont supprimables (cf. DELETE
  // /api/commandes/[id]) — au-delà, on passe par un changement de statut.
  const idsEligibles = commandes.filter((c) => c.statut === 'nouveau_colis').map((c) => c.id);
  const touteLaSelection = idsEligibles.length > 0 && idsEligibles.every((id) => selected.has(id));

  function toggleUn(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTout() {
    setSelected(touteLaSelection ? new Set() : new Set(idsEligibles));
  }

  async function supprimerSelection() {
    if (selected.size === 0) return;
    if (!confirm(`Supprimer définitivement ${selected.size} colis sélectionné(s) ?`)) return;
    setSuppressionEnCours(true);
    setError(null);
    try {
      await apiPost('/api/commandes/bulk-delete', { colisIds: Array.from(selected) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSuppressionEnCours(false);
    }
  }

  // Télécharge en Excel les colis correspondant aux filtres actuellement
  // appliqués (mêmes critères que le tableau affiché, sans pagination).
  async function exporterExcel() {
    setExportEnCours(true);
    setError(null);
    try {
      const params = buildFiltreParams();
      const res = await fetch(`/api/commandes/export?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && typeof data.error === 'string' ? data.error : null) ?? `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `colis-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'export');
    } finally {
      setExportEnCours(false);
    }
  }

  function reinitialiserFiltres() {
    setEtatPaiementFiltre('');
    setVilleFiltre('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    load({ etatPaiement: '', ville: '', dateFrom: '', dateTo: '', search: '' });
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutFiltre, etatPaiementFiltre]);

  const activeHref = statutFiltre === 'nouveau_colis' ? '/marchand/colis?statut=nouveau_colis' : '/marchand/colis';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Colis</h1>
        <div className="flex gap-2">
          <Link href="/marchand/colis/import" className="btn-outline flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Importer (CSV/Excel)
          </Link>
          <Link href="/marchand/colis/nouveau" className="btn-primary flex items-center gap-2">
            <PackagePlus className="h-4 w-4" />
            Nouveau colis
          </Link>
        </div>
      </div>

      <ColisSubNav activeHref={activeHref} />

      <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        {/* Recherche principale : grande et bien visible, c'est l'action la plus fréquente. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 opacity-40" />
            <input
              className="input-basic w-full py-3 pl-11 text-base"
              placeholder="Rechercher par nom, téléphone ou code de suivi…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </div>
          <button onClick={() => load()} className="btn-primary px-6 py-3 text-base">
            Rechercher
          </button>
        </div>

        {/* Filtres secondaires : chacun étiqueté pour rester lisible même une fois pliés. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="flex h-4 items-center gap-1 text-xs font-semibold uppercase tracking-wide opacity-60">Statut</span>
            <select className="input-basic w-full py-2.5" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
              <option value="">Tous les statuts</option>
              {STATUTS_COMMANDE.map((s) => (
                <option key={s} value={s}>
                  {LABELS_STATUT_COMMANDE[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="flex h-4 items-center gap-1 text-xs font-semibold uppercase tracking-wide opacity-60">
              <Wallet className="h-3 w-3 shrink-0" />
              État paiement
            </span>
            <select
              className="input-basic w-full py-2.5"
              value={etatPaiementFiltre}
              onChange={(e) => setEtatPaiementFiltre(e.target.value)}
            >
              <option value="">Tous les paiements</option>
              {ETATS_PAIEMENT.map((e) => (
                <option key={e} value={e}>
                  {LABELS_ETAT_PAIEMENT[e]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="flex h-4 items-center gap-1 text-xs font-semibold uppercase tracking-wide opacity-60">
              <MapPin className="h-3 w-3 shrink-0" />
              Ville
            </span>
            <input
              className="input-basic w-full py-2.5"
              placeholder="Ex. Casablanca"
              value={villeFiltre}
              onChange={(e) => setVilleFiltre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </label>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex h-4 items-center gap-1 text-xs font-semibold uppercase tracking-wide opacity-60">
              <CalendarRange className="h-3 w-3 shrink-0" />
              Période
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                type="date"
                className="input-basic w-full min-w-0 py-2.5"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Du"
              />
              <span className="shrink-0 opacity-40">→</span>
              <input
                type="date"
                className="input-basic w-full min-w-0 py-2.5"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Au"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs opacity-60">
            {filtresActifs > 0 ? `${filtresActifs} filtre${filtresActifs > 1 ? 's' : ''} actif${filtresActifs > 1 ? 's' : ''}` : 'Aucun filtre actif'}
          </span>
          <div className="flex gap-2">
            {filtresActifs > 0 && (
              <button onClick={reinitialiserFiltres} className="btn-outline flex items-center gap-1.5">
                <X className="h-3.5 w-3.5" />
                Réinitialiser
              </button>
            )}
            <button onClick={exporterExcel} disabled={exportEnCours} className="btn-outline flex items-center gap-1.5 disabled:opacity-50">
              <FileDown className="h-3.5 w-3.5" />
              {exportEnCours ? 'Export…' : 'Exporter (Excel)'}
            </button>
            <button onClick={() => load()} className="btn-outline">
              Appliquer les filtres
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900/40 dark:bg-red-950/20">
          <span>{selected.size} colis sélectionné(s)</span>
          <button
            onClick={supprimerSelection}
            disabled={suppressionEnCours}
            className="btn-danger-solid btn-sm flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {suppressionEnCours ? 'Suppression…' : 'Supprimer la sélection'}
          </button>
        </div>
      )}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[1420px]">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={touteLaSelection}
                    onChange={toggleTout}
                    disabled={idsEligibles.length === 0}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Code d&apos;envoi</th>
                <th>Destinataire</th>
                <th>Téléphone</th>
                <th>Marchandise</th>
                <th>Ville</th>
                <th className="text-right">Prix</th>
                <th>Ramassage</th>
                <th>État</th>
                <th>Statut</th>
                <th>Livraison</th>
                <th>Options</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleUn(c.id)}
                      disabled={c.statut !== 'nouveau_colis'}
                      aria-label={`Sélectionner ${c.codeSuivi}`}
                    />
                  </td>
                  <td className="font-mono text-xs font-semibold text-black/70 dark:text-white/70">{c.codeSuivi}</td>
                  <td className="font-medium">{c.clientNom}</td>
                  <td className="whitespace-nowrap">{c.clientTelephone}</td>
                  <td>{c.marchandise?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                  <td>{c.ville}</td>
                  <td className="text-right font-semibold tabular-nums">{c.montantCod} DH</td>
                  <td className="whitespace-nowrap text-xs opacity-70">
                    {c.dateCollecte ? new Date(c.dateCollecte).toLocaleString('fr-FR') : '—'}
                  </td>
                  <td>
                    <EtatPaiementBadge etat={c.etatPaiement} />
                  </td>
                  <td>
                    <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
                  </td>
                  <td className="whitespace-nowrap text-xs opacity-70">
                    {c.dateLivraison ? new Date(c.dateLivraison).toLocaleString('fr-FR') : '—'}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {c.aRisque && (
                        <span className="badge badge-danger">
                          <TriangleAlert className="h-3 w-3" /> Risque
                        </span>
                      )}
                      {c.ouvrir && (
                        <span className="badge badge-neutral">
                          <DoorOpen className="h-3 w-3" /> Ouvrir
                        </span>
                      )}
                      {c.fragile && (
                        <span className="badge badge-warn">
                          <TriangleAlert className="h-3 w-3" /> Fragile
                        </span>
                      )}
                      {c.aRemplacer && <span className="badge badge-brand">Échange</span>}
                      {c.enStock && <span className="badge badge-neutral">Stock</span>}
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate text-xs opacity-70" title={c.notes ?? undefined}>
                    {c.notes ?? '—'}
                  </td>
                  <td>
                    <ColisActionsMenu commande={c} onChanged={load} />
                  </td>
                </tr>
              ))}
              {!chargement && commandes.length === 0 && (
                <tr>
                  <td colSpan={14}>
                    <div className="empty-state">
                      <PackageSearch className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun colis</p>
                      <p className="text-xs">Ajustez vos filtres ou créez un nouveau colis.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function MarchandColisPage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <ColisListContent />
    </Suspense>
  );
}
