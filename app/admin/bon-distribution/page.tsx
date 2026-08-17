'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Settings, Share2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDistribution } from '@/lib/types';

export default function AdminBonDistributionPage() {
  const [bons, setBons] = useState<BonDistribution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: BonDistribution[] }>('/api/bons-distribution')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title flex items-center gap-2">
          <Share2 className="h-6 w-6 text-brand-ink dark:text-brand" />
          Bons de distribution
        </h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/hubs" className="btn-outline flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Gérer les hubs
          </Link>
          <Link href="/admin/bon-distribution/creer" className="btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Nouveau Bon de Distribution
          </Link>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Livreur</th>
              <th>Hub</th>
              <th>Colis</th>
              <th>Statut</th>
              <th>Date de génération</th>
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
                <td>{b.nbColis}</td>
                <td>
                  <span className={`badge ${b.statut === 'en_cours' ? 'bg-cyan-400 text-cyan-950' : 'bg-amber-300 text-amber-950'}`}>
                    {b.statut === 'en_cours' ? 'En cours' : 'Nouveau'}
                  </span>
                </td>
                <td>{new Date(b.dateGeneration).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
            {bons.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center opacity-60">
                  Aucun bon de distribution pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
