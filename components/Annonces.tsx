'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { ecouterAnnonces, type Annonce } from '@/lib/annonces';

// Affichage des notifications instantanées (§ lib/annonces.ts), monté une fois
// dans AdminShell. En bas à droite sur ordinateur, en haut sur téléphone (le
// pouce et le clavier occupent le bas). Un échec reste plus longtemps qu'une
// réussite : il faut le temps de le lire.
const DUREE_MS = { succes: 3500, info: 4000, echec: 7000 } as const;
const MAX_VISIBLES = 4;

// Bip WebAudio, sans fichier : aigu pour une réussite, deux graves pour un
// échec. Silencieux si le navigateur refuse l'audio (aucun geste encore fait).
let contexteAudio: AudioContext | null = null;
function biper(succes: boolean) {
  try {
    contexteAudio ??= new AudioContext();
    const ctx = contexteAudio;
    const notes = succes ? [{ f: 1046, t: 0 }] : [{ f: 220, t: 0 }, { f: 196, t: 0.18 }];
    for (const { f, t } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = succes ? 'sine' : 'square';
      gain.gain.setValueAtTime(0.08, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.16);
    }
  } catch {
    // Audio indisponible : l'annonce visuelle suffit.
  }
}

const STYLES = {
  succes: { classe: 'border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100', Icone: CheckCircle2 },
  echec: { classe: 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100', Icone: XCircle },
  info: { classe: 'border-cyan-600 bg-cyan-50 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100', Icone: Info },
} as const;

export function Annonces() {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);

  useEffect(
    () =>
      ecouterAnnonces((annonce) => {
        if (annonce.son) biper(annonce.type !== 'echec');
        setAnnonces((prev) => [...prev, annonce].slice(-MAX_VISIBLES));
        window.setTimeout(() => setAnnonces((prev) => prev.filter((a) => a.id !== annonce.id)), DUREE_MS[annonce.type]);
      }),
    []
  );

  function fermer(id: number) {
    setAnnonces((prev) => prev.filter((a) => a.id !== id));
  }

  if (annonces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[1000] flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:w-96 print:hidden">
      {annonces.map((a) => {
        const { classe, Icone } = STYLES[a.type];
        return (
          <div
            key={a.id}
            role={a.type === 'echec' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border-l-4 px-3.5 py-3 text-sm font-medium shadow-lg ${classe}`}
          >
            <Icone className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{a.texte}</p>
            <button type="button" onClick={() => fermer(a.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
