'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { BonEnvoiActionsMenu } from '@/components/BonEnvoiActionsMenu';

interface CurrentUser {
  role: 'admin' | 'agent_hub' | string;
}

export default function AdminBonEnvoiPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bons, setBons] = useState<BonEnvoi[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiGet<{ data: BonEnvoi[] }>('/api/bons-envoi')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }

  useEffect(() => {
    apiGet<CurrentUser>('/api/auth/me').then(setUser).catch(() => {});
    load();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Bons d&apos;envoi</h1>
        {user?.role === 'admin' && (
          <Link href="/admin/bon-envoi/creer" className="btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Nouveau Bon d&apos;Envoi
          </Link>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Hub destination</th>
              <th>Colis</th>
              <th>Statut</th>
              <th>Date de génération</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bons.map((b) => (
              <tr key={b.id}>
                <td className="font-mono">
                  <Link href={`/admin/bon-envoi/${b.id}`} className="hover:underline">
                    {b.numero}
                  </Link>
                </td>
                <td>{b.hubDestination?.nom ?? '—'}</td>
                <td>{b.nbColis}</td>
                <td>
                  <span className={`badge ${b.statut === 'recu' ? 'bg-green-600 text-white' : 'bg-cyan-400 text-cyan-950'}`}>
                    {b.statut === 'recu' ? 'Reçu' : 'Nouveau'}
                  </span>
                </td>
                <td>{new Date(b.dateGeneration).toLocaleDateString('fr-FR')}</td>
                <td>
                  {user && (
                    <BonEnvoiActionsMenu
                      bon={b}
                      role={user.role === 'admin' ? 'admin' : 'agent_hub'}
                      onChanged={load}
                    />
                  )}
                </td>
              </tr>
            ))}
            {bons.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center opacity-60">
                  Aucun bon d&apos;envoi pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
