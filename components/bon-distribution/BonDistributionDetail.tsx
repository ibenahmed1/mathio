'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Printer, Truck } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDistribution } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { LABELS_STATUT_BON_DISTRIBUTION, STYLE_STATUT_BON_DISTRIBUTION } from '@/lib/statuts';

// § Module Bon de Distribution — détail d'une tournée.
export function BonDistributionDetail() {
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
        <div className="flex items-center gap-2">
          {/* § Clôture de tournée : accessible tant que le bon n'est pas
              clôturé (déchargement + reddition), en lecture seule ensuite. */}
          <Link href={`/admin/bon-distribution/${bon.id}/cloture`} className="btn-outline flex items-center gap-1.5">
            <Truck className="h-4 w-4" />
            {bon.statut === 'cloture' ? 'Voir la reddition' : 'Clôturer la tournée'}
          </Link>
          <button onClick={() => window.print()} className="btn-primary flex items-center gap-1.5">
            <Printer className="h-4 w-4" />
            Imprimer
          </button>
        </div>
      </div>

      <h1 className="page-title">{bon.numero}</h1>

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
          <span className={`badge ${STYLE_STATUT_BON_DISTRIBUTION[bon.statut]}`}>
            {LABELS_STATUT_BON_DISTRIBUTION[bon.statut]}
          </span>
        </div>
        <div>
          <p className="opacity-60">Généré le</p>
          <p className="font-semibold">{new Date(bon.dateGeneration).toLocaleString('fr-FR')}</p>
        </div>
        <div>
          <p className="opacity-60">Planifié par</p>
          <p className="font-semibold">{bon.planner?.nomComplet ?? '—'}</p>
        </div>
      </div>

      {/* Reddition de compte, figée à la clôture : c'est elle qui fait foi
          ensuite, pas le recalcul de l'écran de clôture. */}
      {bon.statut === 'cloture' && (
        <div className="card-tint-strong grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="opacity-60">Clôturée le</p>
            <p className="font-semibold">
              {bon.dateCloture ? new Date(bon.dateCloture).toLocaleString('fr-FR') : '—'}
            </p>
            <p className="text-xs opacity-60">par {bon.cloturePar?.nomComplet ?? '—'}</p>
          </div>
          <div>
            <p className="opacity-60">Livrés / retournés</p>
            <p className="font-semibold">
              {bon.nbColisLivres ?? 0} / {bon.nbColisRetournes ?? 0}
            </p>
          </div>
          <div>
            <p className="opacity-60">Caisse remise</p>
            <p className="font-semibold">{Number(bon.montantRemis ?? 0).toFixed(2)} DH</p>
            <p className="text-xs opacity-60">
              attendu {Number(bon.montantCrbtAttendu ?? 0).toFixed(2)} DH — écart{' '}
              {Number(bon.ecartCaisse ?? 0).toFixed(2)} DH
            </p>
          </div>
          <div>
            <p className="opacity-60">Gains livreur</p>
            <p className="font-semibold">{Number(bon.gainLivreur ?? 0).toFixed(2)} DH</p>
            <p className="text-xs opacity-60">crédités au solde à payer</p>
          </div>
        </div>
      )}

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
                  <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
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
