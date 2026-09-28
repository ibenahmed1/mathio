'use client';

import { permissionsDuRole } from '@/lib/permissions-marchand';
import type { DonneesEquipe, MembreEquipe, RoleEquipe, StatutMembre } from './equipe-types';

// Briques visuelles partagées par les onglets de l'écran Équipe & accès.

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

export const LIBELLES_STATUT: Record<StatutMembre, { texte: string; classe: string; aide: string }> = {
  actif: { texte: 'Actif', classe: 'badge-ok', aide: 'Peut se connecter.' },
  invitation: { texte: 'Invitation envoyée', classe: 'badge-brand', aide: 'N’a pas encore choisi son mot de passe.' },
  invitation_expiree: {
    texte: 'Invitation expirée',
    classe: 'badge-warn',
    aide: 'Le lien a expiré : renvoyez l’invitation.',
  },
  suspendu: { texte: 'Suspendu', classe: 'badge-danger', aide: 'Accès coupé jusqu’à réactivation.' },
  expire: { texte: 'Accès expiré', classe: 'badge-neutral', aide: 'La date limite d’accès est passée.' },
};

export function BadgeStatut({ statut }: { statut: StatutMembre }) {
  const s = LIBELLES_STATUT[statut];
  return (
    <span className={`badge ${s.classe}`} title={s.aide}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {s.texte}
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

// --- Règles de prise, miroir client de lib/equipe-marchand.ts -------------
//
// Servent à griser un bouton plutôt qu'à le laisser échouer ; le serveur
// applique les mêmes règles et reste seul juge.

export function contientTout(detenues: string[], demandees: string[]): boolean {
  const set = new Set(detenues);
  return demandees.every((p) => set.has(p));
}

export function raisonSansPrise(
  donnees: DonneesEquipe,
  membre: MembreEquipe,
  rolesParId: Map<string, RoleEquipe>
): string | null {
  const { moi } = donnees;
  if (!moi.permissions.includes('equipe.gerer')) return 'Votre rôle ne permet pas de gérer l’équipe';
  if (membre.utilisateurId === moi.utilisateurId) return 'Vous ne pouvez pas modifier votre propre accès';
  if (moi.estTitulaire) return null;
  const role = rolesParId.get(membre.roleId);
  if (role && !contientTout(moi.permissions, permissionsDuRole({ cle: role.cle, permissions: role.permissions }))) {
    return 'Ce membre a des droits que vous n’avez pas : réservé au titulaire';
  }
  return null;
}

export function rolesAttribuables(donnees: DonneesEquipe): RoleEquipe[] {
  if (donnees.moi.estTitulaire) return donnees.roles;
  return donnees.roles.filter((r) => contientTout(donnees.moi.permissions, r.permissions));
}

export function Kpi({
  label,
  valeur,
  icone,
  accent,
}: {
  label: string;
  valeur: number;
  icone: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-3 shadow-[var(--mk-shadow)] sm:p-4">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10 ${
          accent ?? 'bg-[color:var(--mk-line-soft)] text-[color:var(--mk-ink-2)]'
        }`}
      >
        {icone}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-black tabular-nums leading-tight sm:text-2xl">{valeur}</span>
        <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-[color:var(--mk-muted)]">
          {label}
        </span>
      </span>
    </div>
  );
}
