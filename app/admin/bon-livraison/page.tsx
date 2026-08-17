'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer, Tags } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDeLivraison } from '@/lib/types';

export default function AdminBonLivraisonPage() {
  const [bons, setBons] = useState<BonDeLivraison[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: BonDeLivraison[] }>('/api/bons-livraison')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons de livraison — tous marchands</h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[640px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Marchand</th>
              <th>Colis</th>
              <th>Montant COD</th>
              <th>Date de génération</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bons.map((b) => (
              <tr key={b.id}>
                <td className="font-mono">{b.numero}</td>
                <td>{b.marchand?.nomBoutique ?? '—'}</td>
                <td>{b.nbColis}</td>
                <td>{Number(b.montantTotalCod).toFixed(2)} DH</td>
                <td>{new Date(b.dateGeneration).toLocaleDateString('fr-FR')}</td>
                <td>
                  <div className="flex gap-2">
                    <Link
                      href={`/bons-livraison/${b.id}?format=a4`}
                      target="_blank"
                      className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
                    >
                      <Printer className="h-3 w-3" />
                      A4
                    </Link>
                    <Link
                      href={`/bons-livraison/${b.id}?format=etiquettes`}
                      target="_blank"
                      className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
                    >
                      <Tags className="h-3 w-3" />
                      Étiquettes
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {bons.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center opacity-60">
                  Aucun bon de livraison généré pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
