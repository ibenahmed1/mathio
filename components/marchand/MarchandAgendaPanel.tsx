'use client';

import { ChevronLeft, ChevronRight, Clock, MapPin, PackageSearch, UserRound } from 'lucide-react';

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const JOURS_COURT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

interface ColisAujourdhui {
  id: string;
  codeSuivi: string;
  clientNom: string;
  ville: string;
  statut: string;
  dateCreation: string;
}

interface DernierClient {
  nom: string;
  ville: string;
  date: string;
}

function heure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function dateRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 1) return "à l'instant";
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffJ = Math.round(diffH / 24);
  return `il y a ${diffJ} j`;
}

function initiales(nom: string) {
  return nom
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function semaineCourante() {
  const aujourdhui = new Date();
  const lundi = new Date(aujourdhui);
  const jourSemaine = (aujourdhui.getDay() + 6) % 7; // 0 = lundi
  lundi.setDate(aujourdhui.getDate() - jourSemaine);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setDate(lundi.getDate() + i);
    return d;
  });
}

export function MarchandAgendaPanel({
  aTraiterAujourdhui,
  derniersClients,
}: {
  aTraiterAujourdhui: ColisAujourdhui[];
  derniersClients: DernierClient[];
}) {
  const aujourdhui = new Date();
  const semaine = semaineCourante();

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-card rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">
            {MOIS[aujourdhui.getMonth()]} {aujourdhui.getFullYear()}
          </p>
          <div className="flex gap-1 opacity-50">
            <ChevronLeft className="h-4 w-4" />
            <ChevronRight className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 flex justify-between gap-1">
          {semaine.map((d) => {
            const estAujourdhui = d.toDateString() === aujourdhui.toDateString();
            return (
              <div
                key={d.toISOString()}
                className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-xs font-semibold transition-all ${
                  estAujourdhui
                    ? 'bg-brand text-brand-foreground shadow-sm shadow-brand/30'
                    : 'text-black/50 dark:text-white/50'
                }`}
              >
                <span className="uppercase">{JOURS_COURT[d.getDay()]}</span>
                <span className="text-sm">{d.getDate()}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <PackageSearch className="h-4 w-4 text-brand-ink dark:text-brand" />
            Colis à traiter aujourd&apos;hui
          </h2>
        </div>
        <ul className="flex flex-col gap-1">
          {aTraiterAujourdhui.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-brand/[0.08]"
            >
              <span className="flex items-center gap-1 rounded-full bg-brand/15 px-2 py-1 text-[11px] font-bold text-brand-ink dark:bg-brand/10 dark:text-brand">
                <Clock className="h-3 w-3" />
                {heure(c.dateCreation)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.clientNom}</p>
                <p className="flex items-center gap-1 truncate text-xs text-black/50 dark:text-white/50">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {c.ville} · {c.codeSuivi}
                </p>
              </div>
            </li>
          ))}
          {aTraiterAujourdhui.length === 0 && (
            <li className="py-4 text-center text-sm opacity-50">Rien à traiter aujourd&apos;hui</li>
          )}
        </ul>
      </div>

      <div className="glass-card rounded-3xl">
        <h2 className="mb-3 text-sm font-bold">Derniers clients</h2>
        <ul className="flex flex-col gap-1">
          {derniersClients.map((c, i) => (
            <li
              key={`${c.nom}-${i}`}
              className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-brand/[0.08]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand-ink dark:bg-brand/10 dark:text-brand">
                {initiales(c.nom) || <UserRound className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.nom}</p>
                <p className="truncate text-xs text-black/50 dark:text-white/50">{c.ville}</p>
              </div>
              <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40">{dateRelative(c.date)}</span>
            </li>
          ))}
          {derniersClients.length === 0 && <li className="py-4 text-center text-sm opacity-50">Aucun client</li>}
        </ul>
      </div>
    </div>
  );
}
