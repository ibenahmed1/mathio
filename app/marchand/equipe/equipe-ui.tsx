'use client';

import { permissionsDuRole } from '@/lib/permissions-marchand';
import type { DonneesEquipe, MembreEquipe, RoleEquipe, StatutMembre } from './equipe-types';

// Briques visuelles partagées par les onglets de l'écran Équipe & accès.
// Avatar et dates viennent de components/equipe/ui-commun.tsx, communs avec
// l'écran Équipe & rôles du back-office.
export { Avatar, dateCourte, depuis, initiales } from '@/components/equipe/ui-commun';

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
