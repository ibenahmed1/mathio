'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Store, Truck } from 'lucide-react';
import { apiPatch } from '@/lib/api-client';

export interface MarchandAlerte {
  id: string;
  nomBoutique: string;
  ville: string | null;
  dateCreation: string;
  contactNom: string;
  contactTelephone: string | null;
}

export interface RamassageAlerte {
  id: string;
  marchandNom: string;
  adresseLibelle: string;
  datePrevue: string;
  creneauHoraire: string | null;
  nbColisEstimes: number | null;
}

export function AlertesPanel({
  marchands,
  ramassages,
}: {
  marchands: MarchandAlerte[];
  ramassages: RamassageAlerte[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approuver(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await apiPatch(`/api/marchands/${id}/statut`, { statut: 'actif' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="dashboard-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70">
            <Store className="h-4 w-4" />
            Marchands à valider
          </h2>
          <Link href="/admin/marchands" className="text-sm font-semibold text-brand-foreground hover:underline dark:text-brand">
            Voir tout
          </Link>
        </div>

        {error && <p className="mb-2 text-sm font-medium text-red-600">{error}</p>}

        <ul className="flex flex-col gap-2">
          {marchands.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand/[0.05] px-3 py-2 dark:bg-white/[0.03]"
            >
              <div>
                <p className="text-sm font-semibold">{m.nomBoutique}</p>
                <p className="text-xs opacity-60">
                  {m.contactNom} — {m.contactTelephone ?? '—'} {m.ville ? `· ${m.ville}` : ''}
                </p>
              </div>
              <button
                onClick={() => approuver(m.id)}
                disabled={pendingId === m.id}
                className="btn-primary px-2 py-1 text-xs"
              >
                {pendingId === m.id ? 'Approbation…' : 'Approuver'}
              </button>
            </li>
          ))}
          {marchands.length === 0 && <li className="py-4 text-center text-sm opacity-60">Aucune demande en attente</li>}
        </ul>
      </div>

      <div className="dashboard-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70">
            <Truck className="h-4 w-4" />
            Ramassages à traiter
          </h2>
          <Link href="/admin/ramassages" className="text-sm font-semibold text-brand-foreground hover:underline dark:text-brand">
            Voir tout
          </Link>
        </div>

        <ul className="flex flex-col gap-2">
          {ramassages.map((r) => (
            <li key={r.id} className="rounded-xl bg-brand/[0.05] px-3 py-2 dark:bg-white/[0.03]">
              <p className="text-sm font-semibold">{r.marchandNom}</p>
              <p className="text-xs opacity-60">
                {r.adresseLibelle} — {new Date(r.datePrevue).toLocaleDateString('fr-FR')}
                {r.creneauHoraire ? ` · ${r.creneauHoraire}` : ''}
                {r.nbColisEstimes ? ` · ~${r.nbColisEstimes} colis` : ''}
              </p>
            </li>
          ))}
          {ramassages.length === 0 && <li className="py-4 text-center text-sm opacity-60">Aucune demande en attente</li>}
        </ul>
      </div>
    </div>
  );
}
