'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonRetour } from '@/lib/types';

// § Ramasseur — les bons de retour qui lui sont confiés. La route API filtre
// déjà sur `ramasseurId = session.sub` : rien à passer depuis le client, et
// rien d'autre n'est atteignable.
export default function MesBonsRetourPage() {
  const [bons, setBons] = useState<BonRetour[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: BonRetour[] }>('/api/bons-retour?pageSize=50')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  const enCours = bons.filter((b) => b.statut === 'en_cours');
  const clos = bons.filter((b) => b.statut === 'remis');

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <Link href="/ramasseur" className="flex w-fit items-center gap-1 text-sm opacity-70">
        <ChevronLeft className="h-4 w-4" />
        Accueil
      </Link>

      <h1 className="flex items-center gap-2 text-xl font-black">
        <Undo2 className="h-5 w-5 text-brand-ink dark:text-brand" />
        Bons de retour
      </h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">À remettre ({enCours.length})</h2>
        {enCours.map((b) => (
          <Link
            key={b.id}
            href={`/ramasseur/bons-retour/${b.id}`}
            className="flex items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-3 transition hover:border-brand dark:border-white/15"
          >
            <div className="min-w-0">
              <p className="truncate font-bold">{b.marchand?.nomBoutique}</p>
              <p className="font-mono text-xs opacity-60">
                {b.numero} · {b.nbColis} colis
              </p>
              {b.marchand?.ville && <p className="truncate text-xs opacity-60">{b.marchand.ville}</p>}
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-40" />
          </Link>
        ))}
        {enCours.length === 0 && <p className="text-sm opacity-60">Aucun bon en cours.</p>}
      </section>

      {clos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">Clôturés</h2>
          {clos.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 opacity-60 dark:border-white/15"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{b.marchand?.nomBoutique}</p>
                <p className="font-mono text-xs">{b.numero}</p>
              </div>
              <span className="shrink-0 text-xs">
                {b.dateRemise ? new Date(b.dateRemise).toLocaleDateString('fr-FR') : ''}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
