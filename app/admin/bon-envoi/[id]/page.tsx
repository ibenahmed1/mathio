'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { BonEnvoiActionsMenu } from '@/components/BonEnvoiActionsMenu';
import { MiseEnDistribution } from '@/components/admin/MiseEnDistribution';
import { TransmissionBon } from '@/components/admin/TransmissionBon';
import { attendRemise, gereLesBons } from '@/lib/circuit-shipeh';
import { CodeColis } from '@/components/colis/CodeColis';

interface CurrentUser {
  role: 'admin' | 'agent_hub' | string;
}

export default function DetailBonEnvoiPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [bon, setBon] = useState<BonEnvoi | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    apiGet<BonEnvoi>(`/api/bons-envoi/${params.id}`)
      .then(setBon)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    apiGet<CurrentUser>('/api/auth/me').then(setUser).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (loading) return <p className="opacity-60">Chargement…</p>;

  if (error || !bon) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm font-semibold opacity-70 hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour
        </button>
        <p className="text-sm font-medium text-red-600">{error ?? "Bon d'envoi introuvable"}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/bon-envoi" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100">
        <ChevronLeft className="h-4 w-4" />
        Retour aux Bons d&apos;Envoi
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{bon.numero}</h1>
        {user && (
          <BonEnvoiActionsMenu
            bon={bon}
            role={gereLesBons(user.role) ? 'admin' : 'agent_hub'}
            onChanged={load}
            hideDetails
          />
        )}
      </div>

      {/* Bandeau de transmission, toujours en tête : Excel, remise (API ou
          « marquer comme transmis »), bon reçu, mise en distribution — grisés
          avec leur raison quand ils ne servent pas. L'agent de quai consulte
          et réceptionne par le menu Actions. */}
      {gereLesBons(user?.role) && <TransmissionBon bon={bon} onChange={load} />}

      <div className="card-tint-strong grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="opacity-60">{bon.prestataire ? 'Transporteur' : 'Destination'}</p>
          <p className="font-semibold">{bon.prestataire?.nom ?? bon.hubDestination?.nom ?? '—'}</p>
        </div>
        <div>
          <p className="opacity-60">Colis</p>
          <p className="font-semibold">{bon.nbColis}</p>
        </div>
        <div>
          <p className="opacity-60">Statut</p>
          <span className={`badge ${bon.statut === 'recu' ? 'bg-green-600 text-white' : 'bg-cyan-400 text-cyan-950'}`}>
            {bon.statut === 'recu' ? 'Reçu' : 'Nouveau'}
          </span>
        </div>
        <div>
          <p className="opacity-60">Généré le</p>
          <p className="font-semibold">{new Date(bon.dateGeneration).toLocaleString('fr-FR')}</p>
        </div>
        {bon.dateReception && (
          <div>
            <p className="opacity-60">Reçu le</p>
            <p className="font-semibold">{new Date(bon.dateReception).toLocaleString('fr-FR')}</p>
          </div>
        )}
        {bon.receptionnaire && (
          <div>
            <p className="opacity-60">Réceptionné par</p>
            <p className="font-semibold">{bon.receptionnaire.nomComplet}</p>
          </div>
        )}
      </div>

      {/* Bon reçu : colis chez le transporteur, à mettre en distribution à la main. */}
      {gereLesBons(user?.role) && bon.statut === 'recu' && (
        <div id="mise-en-distribution">
          <MiseEnDistribution
            key={(bon.commandes ?? []).map((c) => `${c.id}:${c.statut}`).join(',')}
            bon={bon}
            onFait={load}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[640px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Marchand</th>
              <th>Ville</th>
              <th>COD</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {(bon.commandes ?? []).map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">
                  <CodeColis id={c.id} code={c.codeSuivi} />
                </td>
                <td>{c.marchand?.nomBoutique ?? '—'}</td>
                <td>{c.ville}</td>
                <td className="whitespace-nowrap">{c.montantCod} MAD</td>
                <td>
                  <StatutBadge statut={c.statut} hubVille={c.statut === 'recu_au_hub' ? c.hubActuel?.ville : undefined} />
                  {c.statut === 'en_transit' && c.hubArriveeNom && (
                    <p className="mt-1 text-xs opacity-60">vers {c.hubArriveeNom}</p>
                  )}
                  {attendRemise({ source: c.source ?? 'manuel', enStock: c.enStock, statut: c.statut }) && (
                    <p className="mt-1 text-xs opacity-60">en attente de remise</p>
                  )}
                </td>
              </tr>
            ))}
            {(bon.commandes ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center opacity-60">
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
