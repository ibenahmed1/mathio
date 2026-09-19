'use client';

import { KeyRound, Store, Truck } from 'lucide-react';
import type { PlateformeResume } from '@/lib/types';

export function ListePlateformes({
  plateformes,
  selectionId,
  onSelect,
}: {
  plateformes: PlateformeResume[];
  selectionId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {plateformes.map((p) => {
        const actif = p.id === selectionId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              actif
                ? 'border-brand bg-brand/10'
                : 'border-black/[0.07] bg-white hover:bg-brand/[0.06] dark:border-white/10 dark:bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{p.nom}</span>
              <span className={p.actif ? 'badge badge-ok' : 'badge badge-danger'}>
                {p.actif ? 'Active' : 'Suspendue'}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-black/45 dark:text-white/45">{p.code}</div>
            <div className="mt-2 flex gap-3 text-[11px] font-semibold text-black/50 dark:text-white/50">
              <span className="inline-flex items-center gap-1">
                <KeyRound size={12} /> {p.nbClesActives} clé{p.nbClesActives > 1 ? 's' : ''}
              </span>
              {/* La nature du compte se lit d'un coup d'œil : un transporteur
                  n'a pas de marchands synchronisés, et afficher « 0 marchand »
                  sur sa carte laisserait croire à une synchronisation en
                  panne. */}
              {p.prestataire ? (
                <span className="inline-flex items-center gap-1">
                  <Truck size={12} /> {p.prestataire.nom}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Store size={12} /> {p.nbMarchands} marchand{p.nbMarchands > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
