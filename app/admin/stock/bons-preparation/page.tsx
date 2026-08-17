'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDePreparation } from '@/lib/types';
import { Button } from '@/components/admin/Button';
import { BonPreparationActionsMenu } from '@/components/BonPreparationActionsMenu';

const TAILLE_PAGE = 20;

function StatutBonBadge({ statut }: { statut: BonDePreparation['statut'] }) {
  if (statut === 'validee') return <span className="badge bg-green-600 text-white">Reçu</span>;
  return <span className="badge badge-neutral">En attente de réception</span>;
}

export default function AdminStockBonsPreparationPage() {
  const [bons, setBons] = useState<BonDePreparation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [chargement, setChargement] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(pageDemandee: number) {
    setChargement(true);
    setError(null);
    try {
      const res = await apiGet<{ data: BonDePreparation[]; total: number }>(
        `/api/bons-preparation?page=${pageDemandee}&pageSize=${TAILLE_PAGE}`
      );
      setBons(res.data);
      setTotal(res.total);
      setPage(pageDemandee);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / TAILLE_PAGE));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons de préparation</h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[720px]">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Marchand</th>
                <th>Colis</th>
                <th>Statut</th>
                <th>Date de génération</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bons.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs font-semibold">{b.numero}</td>
                  <td>{b.marchand?.nomBoutique ?? '—'}</td>
                  <td>{b.nbColis}</td>
                  <td>
                    <StatutBonBadge statut={b.statut} />
                  </td>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(b.dateGeneration).toLocaleString('fr-FR')}</td>
                  <td>
                    <BonPreparationActionsMenu bon={b} onChanged={() => load(page)} />
                  </td>
                </tr>
              ))}
              {!chargement && bons.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <FileText className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun bon de préparation généré pour le moment</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="opacity-60">
          {total > 0 ? `${(page - 1) * TAILLE_PAGE + 1}–${Math.min(page * TAILLE_PAGE, total)} sur ${total} bons` : 'Aucun bon'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-xs">
            Précédent
          </Button>
          <span className="opacity-60">
            Page {page} / {totalPages}
          </span>
          <Button variant="secondary" onClick={() => load(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-xs">
            Suivant
          </Button>
        </div>
      </div>
    </div>
  );
}
