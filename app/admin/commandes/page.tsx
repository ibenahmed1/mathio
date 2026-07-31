'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert, DoorOpen } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import type { Commande, Utilisateur } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { EtatPaiementBadge } from '@/components/EtatPaiementBadge';
import { STATUTS_COMMANDE, LABELS_STATUT_COMMANDE, ETATS_PAIEMENT, LABELS_ETAT_PAIEMENT } from '@/lib/statuts';
import { ColisActionsMenu } from '@/components/admin/ColisActionsMenu';
import { ColisTrackingModal } from '@/components/admin/ColisTrackingModal';

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

  async function load() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (ville) params.set('ville', ville);
      if (statutFiltre) params.set('statut', statutFiltre);
      if (etatPaiementFiltre) params.set('etatPaiement', etatPaiementFiltre);
      if (livreurFiltre) params.set('livreurId', livreurFiltre);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('pageSize', '100');
      const res = await apiGet<{ data: Commande[] }>(`/api/commandes?${params.toString()}`);
      setCommandes(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    apiGet<{ data: Utilisateur[] }>('/api/utilisateurs?role=livreur')
      .then((res) => setLivreurs(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutFiltre, etatPaiementFiltre, livreurFiltre, dateFrom, dateTo]);

  async function assignerLivreur(id: string, livreurId: string) {
    setError(null);
    try {
      await apiPatch(`/api/commandes/${id}`, { livreurId: livreurId || null });
      load();
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
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <input className="input-basic w-32" placeholder="Ville" value={ville} onChange={(e) => setVille(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
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
        <button onClick={load} className="btn-outline">
          Rechercher
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[1500px]">
            <thead>
              <tr>
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
                    <StatutBadge statut={c.statut} />
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
                    <ColisActionsMenu commande={c} onChanged={load} />
                  </td>
                </tr>
              ))}
              {commandes.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-4 text-center opacity-60">
                    Aucun colis
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {trackingId && <ColisTrackingModal commandeId={trackingId} onClose={() => setTrackingId(null)} />}
    </div>
  );
}
