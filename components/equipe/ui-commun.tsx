'use client';

// Briques visuelles communes aux écrans d'équipe : Équipe & accès du marchand
// (app/marchand/equipe) et Équipe & rôles du back-office (app/admin/equipe).
// Rien ici ne dépend des variables de couleur d'un espace (--mk-*) : ces
// pièces doivent tenir sur le fond de l'un comme de l'autre.

const TEINTES = [
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
];

export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  return ((mots[0][0] ?? '') + (mots.length > 1 ? mots[mots.length - 1][0] : '')).toUpperCase();
}

// Teinte stable par personne (dérivée de son identifiant) : la même pastille
// d'une visite à l'autre, sans rien stocker.
export function Avatar({ nom, graine, taille = 'md' }: { nom: string; graine: string; taille?: 'sm' | 'md' }) {
  let h = 0;
  for (let i = 0; i < graine.length; i += 1) h = (h * 31 + graine.charCodeAt(i)) >>> 0;
  const teinte = TEINTES[h % TEINTES.length];
  const dim = taille === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs';
  return (
    <span aria-hidden className={`grid ${dim} shrink-0 place-items-center rounded-full font-black ${teinte}`}>
      {initiales(nom)}
    </span>
  );
}

export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// « il y a 3 h », « hier », puis la date : ce qu'on cherche d'un coup d'œil
// dans une colonne « dernière connexion ».
export function depuis(iso: string | null | undefined): string {
  if (!iso) return 'Jamais';
  const ecart = Date.now() - new Date(iso).getTime();
  const min = Math.round(ecart / 60000);
  if (min < 1) return 'À l’instant';
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j === 1) return 'Hier';
  if (j < 7) return `Il y a ${j} jours`;
  return dateCourte(iso);
}
