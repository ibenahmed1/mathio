'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert, DoorOpen, Trash2 } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Commande, Utilisateur } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { EtatPaiementBadge } from '@/components/EtatPaiementBadge';
import { STATUTS_COMMANDE, LABELS_STATUT_COMMANDE, ETATS_PAIEMENT, LABELS_ETAT_PAIEMENT } from '@/lib/statuts';
import { ColisActionsMenu } from '@/components/admin/ColisActionsMenu';
import { ColisTrackingModal } from '@/components/admin/ColisTrackingModal';

// Plafond serveur (voir GET /api/commandes) — au-delà, il faut paginer plutôt
// que d'augmenter pageSize.
const TAILLE_PAGE = 100;

export default function AdminCommandesPage() {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [livreurs, setLivreurs] = useState<Utilisateur[]>([]);
  const [search, setSearch] = useState('');
  const [ville, setVille] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [etatPaiementFiltre, setEtatPaiementFiltre] = useState('');
  const [livreurFiltre, setLivreurFiltre] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  // L'admin n'a aucun périmètre restreint côté serveur (contrairement à
  // marchand/ramasseur/livreur, cf. buildCommandesWhere) : sans pagination
  // ici, seuls les TAILLE_PAGE colis les plus récents étaient jamais visibles,
  // le reste restait inaccessible depuis cette page.
  async function load(pageDemandee: number) {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (ville) params.set('ville', ville);
      if (statutFiltre) params.set('statut', statutFiltre);
      if (etatPaiementFiltre) params.set('etatPaiement', etatPaiementFiltre);
      if (livreurFiltre) params.set('livreurId', livreurFiltre);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      // Les colis stock encore en préparation (§ /admin/stock/nouveaux,
      // /admin/stock/prets) n'ont rien à faire dans la liste back-office
      // générique tant qu'ils n'ont pas quitté le picking Hub.
      params.set('excludeEnPreparationStock', 'true');
      params.set('page', String(pageDemandee));
      params.set('pageSize', String(TAILLE_PAGE));
      const res = await apiGet<{ data: Commande[]; total: number }>(`/api/commandes?${params.toString()}`);
      setCommandes(res.data);
      setTotal(res.total);
      setPage(pageDemandee);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  // Seuls les colis "Nouveau Colis" sont supprimables (cf. DELETE
  // /api/commandes/[id]) — une fois engagés (ramassage, BL, tournée…), on
  // passe par un changement de statut plutôt qu'une suppression définitive.
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
      await load(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSuppressionEnCours(false);
    }
  }

  useEffect(() => {
    apiGet<{ data: Utilisateur[] }>('/api/utilisateurs?role=livreur')
      .then((res) => setLivreurs(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => load(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutFiltre, etatPaiementFiltre, livreurFiltre, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / TAILLE_PAGE));

  async function assignerLivreur(id: string, livreurId: string) {
    setError(null);
    try {
      await apiPatch(`/api/commandes/${id}`, { livreurId: livreurId || null });
      load(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Colis</h1>

      <div className="flex flex-wrap gap-2">
        <input
          className="input-basic"
          placeholder="Rechercher (code, nom, tél)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(1)}
        />
        <input className="input-basic w-32" placeholder="Ville" value={ville} onChange={(e) => setVille(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <select className="input-basic" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
          <option value="">Status (tous)</option>
          {STATUTS_COMMANDE.map((s) => (
            <option key={s} value={s}>
              {LABELS_STATUT_COMMANDE[s]}
            </option>
          ))}
        </select>
        <select className="input-basic" value={etatPaiementFiltre} onChange={(e) => setEtatPaiementFiltre(e.target.value)}>
          <option value="">État (tous)</option>
          {ETATS_PAIEMENT.map((e) => (
            <option key={e} value={e}>
              {LABELS_ETAT_PAIEMENT[e]}
            </option>
          ))}
        </select>
        <select className="input-basic" value={livreurFiltre} onChange={(e) => setLivreurFiltre(e.target.value)}>
          <option value="">Livreur (tous)</option>
          {livreurs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nomComplet}
            </option>
          ))}
        </select>
        <input type="date" className="input-basic" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="input-basic" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button onClick={() => load(1)} className="btn-outline">
          Rechercher
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900/40 dark:bg-red-950/20">
          <span>{selected.size} colis sélectionné(s)</span>
          <button
            onClick={supprimerSelection}
            disabled={suppressionEnCours}
            className="btn-primary flex items-center gap-1.5 bg-red-600 px-3 py-1.5 text-xs hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {suppressionEnCours ? 'Suppression…' : 'Supprimer la sélection'}
          </button>
        </div>
      )}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[1500px]">
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
                <th>Date d&apos;expédition</th>
                <th>Destinataire</th>
                <th>Téléphone</th>
                <th>Nom du magasin</th>
                <th>Marchandise</th>
                <th>Ville</th>
                <th className="text-right">Prix</th>
                <th>Livreur</th>
                <th>Etat</th>
                <th>Status</th>
                <th>Options</th>
                <th>Notes</th>
                <th>Actions</th>
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
                  <td className="font-mono text-xs font-semibold">
                    <button onClick={() => setTrackingId(c.id)} className="hover:underline">
                      {c.codeSuivi}
                    </button>
                  </td>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                  <td>{c.clientNom}</td>
                  <td className="whitespace-nowrap">{c.clientTelephone}</td>
                  <td>{c.marchand?.nomBoutique ?? '—'}</td>
                  <td>{c.marchandise?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                  <td>{c.ville}</td>
                  <td className="text-right font-semibold tabular-nums">{c.montantCod} DH</td>
                  <td>
                    <select
                      className="input-basic px-2 py-1 text-xs"
                      value={c.livreurId ?? ''}
                      onChange={(e) => assignerLivreur(c.id, e.target.value)}
                    >
                      <option value="">— non assigné —</option>
                      {livreurs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nomComplet}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <EtatPaiementBadge etat={c.etatPaiement} />
                  </td>
                  <td>
                    <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
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
                  <td className="max-w-[160px] truncate text-xs opacity-70" title={c.notes ?? undefined}>
                    {c.notes ?? '—'}
                  </td>
                  <td>
                    <ColisActionsMenu commande={c} onChanged={() => load(page)} />
                  </td>
                </tr>
              ))}
              {commandes.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-4 text-center opacity-60">
                    Aucun colis
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="opacity-60">
          {total > 0
            ? `${(page - 1) * TAILLE_PAGE + 1}–${Math.min(page * TAILLE_PAGE, total)} sur ${total} colis`
            : 'Aucun colis'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1}
            className="btn-outline px-2 py-1 text-xs disabled:opacity-40"
          >
            Précédent
          </button>
          <span className="opacity-60">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages}
            className="btn-outline px-2 py-1 text-xs disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      </div>

      {trackingId && <ColisTrackingModal commandeId={trackingId} onClose={() => setTrackingId(null)} />}
    </div>
  );
}
