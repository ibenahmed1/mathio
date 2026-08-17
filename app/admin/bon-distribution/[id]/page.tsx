'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Printer, Share2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDistribution } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';

export default function DetailBonDistributionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [bon, setBon] = useState<BonDistribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<BonDistribution>(`/api/bons-distribution/${params.id}`)
      .then(setBon)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <p className="opacity-60">Chargement…</p>;

  if (error || !bon) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm font-semibold opacity-70 hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour
        </button>
        <p className="text-sm font-medium text-red-600">{error ?? 'Bon de distribution introuvable'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/bon-distribution" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour aux Bons de Distribution
        </Link>
        <button onClick={() => window.print()} className="btn-primary flex items-center gap-1.5">
          <Printer className="h-4 w-4" />
          Imprimer
        </button>
      </div>

      <h1 className="page-title flex items-center gap-2">
        <Share2 className="h-6 w-6 text-brand-ink dark:text-brand" />
        {bon.numero}
      </h1>

      <div className="card-tint-strong grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="opacity-60">Livreur</p>
          <p className="font-semibold">{bon.livreur?.nomComplet ?? '—'}</p>
        </div>
        <div>
          <p className="opacity-60">Zone (hub)</p>
          <p className="font-semibold">{bon.hub?.nom ?? '—'}</p>
        </div>
        <div>
          <p className="opacity-60">Colis</p>
          <p className="font-semibold">{bon.nbColis}</p>
        </div>
        <div>
          <p className="opacity-60">Statut</p>
          <span className={`badge ${bon.statut === 'en_cours' ? 'bg-cyan-400 text-cyan-950' : 'bg-amber-300 text-amber-950'}`}>
            {bon.statut === 'en_cours' ? 'En cours' : 'Nouveau'}
          </span>
        </div>
        <div>
          <p className="opacity-60">Généré le</p>
          <p className="font-semibold">{new Date(bon.dateGeneration).toLocaleString('fr-FR')}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[640px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Marchand</th>
              <th>Client</th>
              <th>Ville</th>
              <th>COD</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {(bon.commandes ?? []).map((c) => (
              <tr key={c.id}>
                <td className="font-mono font-semibold">{c.codeSuivi}</td>
                <td>{c.marchand?.nomBoutique ?? '—'}</td>
                <td>{c.clientNom}</td>
                <td>{c.ville}</td>
                <td className="whitespace-nowrap">{c.montantCod} MAD</td>
                <td>
                  <StatutBadge statut={c.statut} />
                </td>
              </tr>
            ))}
            {(bon.commandes ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center opacity-60">
                  Aucun colis dans ce bon.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
