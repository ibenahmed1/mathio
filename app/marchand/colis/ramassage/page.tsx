'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { ColisSubNav } from '../ColisSubNav';

// RG-15/16 : colis en attente de ramassage mais pas encore rattachés à une tournée.
export default function ColisPourRamassagePage() {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: Commande[] }>('/api/commandes?statut=attente_de_ramassage')
      .then((res) => setCommandes(res.data.filter((c) => !c.ramassageId)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Colis</h1>
        <Link href="/marchand/ramassages" className="btn-primary flex items-center gap-2">
          <Truck className="h-4 w-4" />
          Demander un ramassage
        </Link>
      </div>

      <ColisSubNav />

      <p className="text-sm opacity-70">Colis en attente de ramassage, pas encore rattachés à une tournée.</p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[560px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Client</th>
              <th>Ville</th>
              <th>Montant</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.id}>
                <td className="font-mono">{c.codeSuivi}</td>
                <td>{c.clientNom}</td>
                <td>{c.ville}</td>
                <td>{c.montantCod} DH</td>
                <td>
                  <StatutBadge statut={c.statut} />
                </td>
              </tr>
            ))}
            {commandes.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center opacity-60">
                  Aucun colis en attente de ramassage
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
