'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  History,
  KeyRound,
  Pause,
  Pencil,
  Play,
  ShieldCheck,
  ShieldMinus,
  ShieldPlus,
  Trash2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { LigneJournalEquipe } from '@/lib/journal-equipe-admin';

// Onglet Journal de l'écran Équipe & rôles : même présentation que le journal
// de l'équipe marchande (app/marchand/equipe/OngletJournal.tsx), sur les
// gestes tracés par lib/journal-equipe-admin.ts.

const ACTIONS: Record<string, { texte: string; icone: LucideIcon; teinte: string }> = {
  compte_cree: { texte: 'a ajouté', icone: UserPlus, teinte: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  compte_modifie: { texte: 'a modifié', icone: Pencil, teinte: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  fonction_changee: { texte: 'a changé le rôle de', icone: ShieldCheck, teinte: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  compte_desactive: { texte: 'a désactivé', icone: Pause, teinte: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  compte_active: { texte: 'a réactivé', icone: Play, teinte: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  mot_de_passe_reinitialise: {
    texte: 'a défini un nouveau mot de passe pour',
    icone: KeyRound,
    teinte: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  },
  compte_supprime: { texte: 'a supprimé un compte', icone: Trash2, teinte: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  role_cree: { texte: 'a créé le rôle', icone: ShieldPlus, teinte: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  role_modifie: { texte: 'a modifié le rôle', icone: ShieldCheck, teinte: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  role_supprime: { texte: 'a supprimé un rôle', icone: ShieldMinus, teinte: 'bg-red-500/15 text-red-700 dark:text-red-400' },
};

function jourLisible(d: Date): string {
  const aujourdHui = new Date();
  const hier = new Date(Date.now() - 86400000);
  if (d.toDateString() === aujourdHui.toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Journal des gestes d'administration de l'équipe, groupé par jour.
export function OngletJournalEquipe() {
  const [lignes, setLignes] = useState<LigneJournalEquipe[]>([]);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (avant?: string) => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await apiGet<{ data: LigneJournalEquipe[]; suivant: string | null }>(
        `/api/utilisateurs/journal${avant ? `?avant=${encodeURIComponent(avant)}` : ''}`
      );
      setLignes((prev) => (avant ? [...prev, ...res.data] : res.data));
      setSuivant(res.suivant);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => charger());
  }, [charger]);

  const groupes: { jour: string; lignes: LigneJournalEquipe[] }[] = [];
  for (const l of lignes) {
    const jour = jourLisible(new Date(l.horodatage));
    const dernier = groupes[groupes.length - 1];
    if (dernier?.jour === jour) dernier.lignes.push(l);
    else groupes.push({ jour, lignes: [l] });
  }

  if (!chargement && lignes.length === 0 && !erreur) {
    return (
      <div className="table-card">
        <div className="empty-state">
          <History className="mb-1 h-8 w-8 opacity-40" />
          <p className="font-semibold text-black/70 dark:text-white/70">Aucune activité pour le moment</p>
          <p>Ajouts, changements de rôle, désactivations et mots de passe apparaîtront ici.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {erreur && <p className="form-error">{erreur}</p>}
      {groupes.map((g) => (
        <section key={g.jour}>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/45 first-letter:uppercase dark:text-white/45">
            {g.jour}
          </h3>
          <ol className="overflow-hidden rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] shadow-[var(--mk-shadow)]">
            {g.lignes.map((l) => {
              const a = ACTIONS[l.action] ?? { texte: l.action, icone: History, teinte: 'bg-black/[0.06]' };
              const Icone = a.icone;
              return (
                <li
                  key={l.id}
                  className="flex items-start gap-3 border-b border-black/[0.05] px-4 py-3 last:border-b-0 dark:border-white/[0.06]"
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${a.teinte}`}>
                    <Icone className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="[overflow-wrap:anywhere]">
                      <strong>{l.auteur}</strong> {a.texte} {l.cible && <strong>{l.cible}</strong>}
                    </p>
                    {l.details && <p className="text-xs text-black/55 [overflow-wrap:anywhere] dark:text-white/55">{l.details}</p>}
                  </div>
                  <time dateTime={l.horodatage} className="shrink-0 text-xs tabular-nums text-black/45 dark:text-white/45">
                    {new Date(l.horodatage).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {chargement && <p className="text-center text-sm opacity-60">Chargement…</p>}
      {suivant && !chargement && (
        <button type="button" className="btn-outline self-center" onClick={() => charger(suivant)}>
          Voir plus
        </button>
      )}
    </div>
  );
}
