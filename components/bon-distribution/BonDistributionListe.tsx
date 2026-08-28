'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Plus, Settings, Truck } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDistribution } from '@/lib/types';
import { LABELS_STATUT_BON_DISTRIBUTION, STYLE_STATUT_BON_DISTRIBUTION } from '@/lib/statuts';

type FiltreStatut = 'toutes' | 'en_cours' | 'cloture';

const FILTRES: { cle: FiltreStatut; label: string }[] = [
  { cle: 'en_cours', label: 'Tournées ouvertes' },
  { cle: 'cloture', label: 'Clôturées' },
  { cle: 'toutes', label: 'Toutes' },
];

// § Module Bon de Distribution — liste des tournées. Servi dans le seul
// back-office (§ /admin/bon-distribution) depuis que le Planner y travaille
// lui aussi : les liens internes sont donc écrits en dur, là où un `basePath`
// paramétrait auparavant l'espace de rendu.
export function BonDistributionListe() {
  const [bons, setBons] = useState<BonDistribution[]>([]);
  const [filtre, setFiltre] = useState<FiltreStatut>('en_cours');
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ role: string }>('/api/auth/me')
      .then((u) => setRole(u.role))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const query = filtre === 'toutes' ? '' : `?statut=${filtre}`;
    apiGet<{ data: BonDistribution[] }>(`/api/bons-distribution${query}`)
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [filtre]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Bons de distribution</h1>
        <div className="flex items-center gap-2">
          {/* Le référentiel des hubs n'est ouvert qu'à l'admin (§ /admin/hubs,
              roles ADMIN_SEUL dans la nav) : le planner travaille sur SON hub,
              il ne le choisit pas. */}
          {role === 'admin' && (
            <Link href="/admin/hubs" className="btn-outline flex items-center gap-1.5">
              <Settings className="h-4 w-4" />
              Gérer les hubs
            </Link>
          )}
          <Link href="/admin/bon-distribution/creer" className="btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Nouveau Bon de Distribution
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTRES.map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFiltre(f.cle)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              filtre === f.cle
                ? 'bg-brand text-brand-ink'
                : 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[860px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Livreur</th>
              <th>Hub</th>
              <th>Colis</th>
              <th>Statut</th>
              <th>Date de génération</th>
              <th>Caisse remise</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bons.map((b) => (
              <tr key={b.id}>
                <td className="font-mono">
                  <Link href={`/admin/bon-distribution/${b.id}`} className="hover:underline">
                    {b.numero}
                  </Link>
                </td>
                <td>{b.livreur?.nomComplet ?? '—'}</td>
                <td>{b.hub?.nom ?? '—'}</td>
                <td>
                  {b.statut === 'cloture' ? (
                    <span title="livrés / retournés">
                      {b.nbColisLivres ?? 0} / {b.nbColisRetournes ?? 0}
                    </span>
                  ) : (
                    b.nbColis
                  )}
                </td>
                <td>
                  <span className={`badge ${STYLE_STATUT_BON_DISTRIBUTION[b.statut]}`}>
                    {LABELS_STATUT_BON_DISTRIBUTION[b.statut]}
                  </span>
                </td>
                <td>{new Date(b.dateGeneration).toLocaleDateString('fr-FR')}</td>
                <td className="whitespace-nowrap">
                  {b.statut === 'cloture' ? `${Number(b.montantRemis ?? 0).toFixed(2)} DH` : '—'}
                </td>
                <td>
                  <Link
                    href={`/admin/bon-distribution/${b.id}/cloture`}
                    className="flex items-center gap-1 text-xs font-semibold hover:underline"
                  >
                    {b.statut === 'cloture' ? <Lock className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
                    {b.statut === 'cloture' ? 'Reddition' : 'Clôturer'}
                  </Link>
                </td>
              </tr>
            ))}
            {bons.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center opacity-60">
                  Aucun bon de distribution pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
