'use client';

import { useMemo, useState } from 'react';
import { Crown, Key, Pencil, Search, Trash2, Users, Wallet } from 'lucide-react';
import { apiDelete, apiPatch } from '@/lib/api-client';
import type { Utilisateur } from '@/lib/types';
import { IconButton } from '@/components/admin/IconButton';
import { ReinitialiserMotDePasse } from '@/components/ReinitialiserMotDePasse';
import { TarifsVilleModal } from '@/components/admin/TarifsVilleModal';
import type { UserFormMode } from '@/components/admin/UserFormModal';
import { Avatar, dateCourte, depuis } from '@/components/equipe/ui-commun';
import { FONCTIONS_EQUIPE, nomFonction } from '@/lib/fonctions-equipe';
import type { RoleBackofficeExpose } from '@/lib/roles-backoffice';

// Onglet Membres de l'écran Équipe & rôles : même construction que l'onglet
// Membres de l'équipe marchande (app/marchand/equipe/OngletMembres.tsx) —
// barre d'outils, compte épinglé, cartes au téléphone, tableau sur écran large.

export interface Moi {
  id: string;
  nomComplet: string;
  telephone: string | null;
  email: string | null;
  role: string;
}

type FiltreStatut = 'tous' | 'actifs' | 'bloques';

const FILTRES: [FiltreStatut, string, (u: Utilisateur) => boolean][] = [
  ['tous', 'Tous', () => true],
  ['actifs', 'Actifs', (u) => u.actif],
  ['bloques', 'Désactivés', (u) => !u.actif],
];

export function OngletMembresAdmin({
  membres,
  roles,
  moi,
  recharger,
  onModifier,
}: {
  membres: Utilisateur[];
  roles: RoleBackofficeExpose[];
  moi: Moi | null;
  recharger: () => void;
  onModifier: (mode: UserFormMode) => void;
}) {
  const [recherche, setRecherche] = useState('');
  const [filtreRole, setFiltreRole] = useState('tous');
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>('tous');
  const [erreur, setErreur] = useState<string | null>(null);
  const [resetPour, setResetPour] = useState<Utilisateur | null>(null);
  const [tarifsPour, setTarifsPour] = useState<Utilisateur | null>(null);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const test = FILTRES.find(([k]) => k === filtreStatut)?.[2] ?? (() => true);
    return membres.filter((u) => {
      if (filtreRole !== 'tous' && u.roleBackofficeId !== filtreRole) return false;
      if (!test(u)) return false;
      if (!q) return true;
      return [u.nomComplet, u.email ?? '', u.telephone ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [membres, recherche, filtreRole, filtreStatut]);

  async function basculerActif(u: Utilisateur) {
    setErreur(null);
    try {
      await apiPatch(`/api/utilisateurs/${u.id}/actif`, { actif: !u.actif });
      recharger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimer(u: Utilisateur) {
    if (!window.confirm(`Supprimer définitivement le compte "${u.nomComplet}" ? Cette action est irréversible.`)) return;
    setErreur(null);
    try {
      await apiDelete(`/api/utilisateurs/${u.id}`);
      recharger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    }
  }

  const filtreActif = recherche.trim() !== '' || filtreRole !== 'tous' || filtreStatut !== 'tous';
  const actions = (u: Utilisateur, className?: string) => (
    <Actions
      u={u}
      className={className}
      onModifier={() => onModifier({ kind: 'edit', utilisateur: u })}
      onBasculer={() => basculerActif(u)}
      onTarifs={() => setTarifsPour(u)}
      onMotDePasse={() => setResetPour(u)}
      onSupprimer={() => supprimer(u)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Barre d'outils : recherche pleine largeur au doigt, filtres dessous. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            className="input-basic w-full pl-9"
            placeholder="Rechercher (nom, email, téléphone)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            aria-label="Rechercher un membre"
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            className="input-basic w-full sm:w-52"
            value={filtreRole}
            onChange={(e) => setFiltreRole(e.target.value)}
            aria-label="Filtrer par rôle"
          >
            <option value="tous">Rôle — Tous</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom}
              </option>
            ))}
          </select>
          <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {FILTRES.map(([cle, libelle, test]) => {
              const n = membres.filter(test).length;
              return (
                <button
                  key={cle}
                  type="button"
                  onClick={() => setFiltreStatut(cle)}
                  aria-pressed={filtreStatut === cle}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition pointer-coarse:py-2 ${
                    filtreStatut === cle
                      ? 'bg-brand text-brand-foreground'
                      : 'text-black/60 hover:bg-black/[0.04] hover:text-black dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white'
                  }`}
                >
                  {libelle}
                  <span className="ml-1 opacity-60">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {erreur && <p className="form-error">{erreur}</p>}

      {/* L'administrateur connecté, épinglé comme le titulaire chez le
          marchand : il n'est pas dans la liste (un admin ne se gère pas d'ici),
          mais une équipe sans son responsable se lit mal. */}
      {moi && !filtreActif && (
        <div className="flex flex-col gap-3 rounded-2xl border border-brand/40 bg-brand/[0.08] p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar nom={moi.nomComplet} graine={moi.id} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="truncate">{moi.nomComplet}</span>
                <span className="badge badge-brand">
                  <Crown className="h-3 w-3" /> {nomFonction(moi.role)}
                </span>
                <span className="badge badge-neutral">Vous</span>
              </p>
              <p className="truncate text-xs text-black/55 dark:text-white/55">{moi.email ?? moi.telephone ?? '—'}</p>
            </div>
          </div>
          <p className="text-xs text-black/55 sm:text-right dark:text-white/55">
            {moi.role === 'admin' ? 'Tous les droits, non modifiables' : 'Votre propre compte'}
          </p>
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <Users className="mb-1 h-8 w-8 opacity-40" />
            {membres.length === 0 ? (
              <>
                <p className="font-semibold text-black/70 dark:text-white/70">Aucun membre pour le moment</p>
                <p>Ajoutez un membre et choisissez précisément ce qu’il pourra faire.</p>
              </>
            ) : (
              <p>Aucun membre ne correspond à ces filtres</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Téléphone et petite tablette : une carte par membre. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {visibles.map((u) => (
              <li
                key={u.id}
                className="rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-4 shadow-[var(--mk-shadow)]"
              >
                <div className="flex items-start gap-3">
                  <Avatar nom={u.nomComplet} graine={u.id} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                      <span className="[overflow-wrap:anywhere]">{u.nomComplet}</span>
                      <BadgeSociete u={u} />
                    </p>
                    <p className="text-xs text-black/55 [overflow-wrap:anywhere] dark:text-white/55">{u.email ?? u.telephone}</p>
                    {u.email && u.telephone && <p className="text-xs text-black/45 dark:text-white/45">{u.telephone}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RoleChip u={u} />
                  <BadgeActif actif={u.actif} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-black/45 dark:text-white/45">Dernière connexion</dt>
                    <dd className="font-semibold">{depuis(u.derniereConnexion)}</dd>
                  </div>
                  <div>
                    <dt className="text-black/45 dark:text-white/45">Ajouté le</dt>
                    <dd className="font-semibold">{dateCourte(u.dateCreation)}</dd>
                  </div>
                </dl>
                {actions(u, 'mt-3 border-t border-black/[0.06] pt-3 dark:border-white/10')}
              </li>
            ))}
          </ul>

          {/* Écran large : le tableau. */}
          <div className="table-card hidden md:block">
            <div className="table-scroll">
              <table className="table-basic min-w-[760px]">
                <thead>
                  <tr>
                    <th>Membre</th>
                    <th>Rôle</th>
                    <th>Statut</th>
                    <th>Dernière connexion</th>
                    <th className="hidden 2xl:table-cell">Ajouté</th>
                    <th className="cell-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar nom={u.nomComplet} graine={u.id} taille="sm" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-semibold">
                              <span className="max-w-[16rem] truncate">{u.nomComplet}</span>
                              <BadgeSociete u={u} />
                            </p>
                            <p className="max-w-[18rem] truncate text-xs text-black/50 dark:text-white/50">
                              {[u.email, u.telephone].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <RoleChip u={u} />
                      </td>
                      <td>
                        <BadgeActif actif={u.actif} />
                      </td>
                      <td className="whitespace-nowrap text-black/70 dark:text-white/70">{depuis(u.derniereConnexion)}</td>
                      {/* Masquée sous 1536 px : l'information reste dans le journal. */}
                      <td className="hidden whitespace-nowrap text-xs text-black/55 2xl:table-cell dark:text-white/55">
                        {dateCourte(u.dateCreation)}
                      </td>
                      <td className="cell-actions">{actions(u, 'justify-end !flex-nowrap')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {resetPour && (
        <ReinitialiserMotDePasse
          utilisateurId={resetPour.id}
          nomComplet={resetPour.nomComplet}
          onDone={() => {
            setResetPour(null);
            recharger();
          }}
        />
      )}
      {tarifsPour && (
        <TarifsVilleModal utilisateurId={tarifsPour.id} nomComplet={tarifsPour.nomComplet} onClose={() => setTarifsPour(null)} />
      )}
    </div>
  );
}

// Rôle attribué (pastille de marque si prédéfini, bleue si personnalisé, comme
// chez le marchand), puis les rôles supplémentaires accordés.
function RoleChip({ u }: { u: Utilisateur }) {
  const predefini = !u.roleBackoffice || u.roleBackoffice.cle !== null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span
        className="inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold shadow-sm dark:border-white/15 dark:bg-white/5"
        title={
          predefini
            ? FONCTIONS_EQUIPE.find((f) => f.role === u.role)?.description
            : `Rôle personnalisé — fonction ${nomFonction(u.role)}`
        }
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${predefini ? 'bg-brand' : 'bg-sky-500'}`} />
        <span className="truncate">{u.roleBackoffice?.nom ?? nomFonction(u.role)}</span>
      </span>
      {u.rolesSupplementaires?.map((r) => (
        <span
          key={r}
          title="Rôle supplémentaire accordé"
          className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold shadow-sm dark:border-white/15 dark:bg-white/5"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-black/30 dark:bg-white/40" />+ {nomFonction(r)}
        </span>
      ))}
    </span>
  );
}

function BadgeActif({ actif }: { actif: boolean }) {
  return (
    <span className={`badge ${actif ? 'badge-ok' : 'badge-danger'}`} title={actif ? 'Peut se connecter.' : 'Accès coupé jusqu’à réactivation.'}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {actif ? 'Actif' : 'Désactivé'}
    </span>
  );
}

// § Comptes livreurs : une société de livraison nous facture, elle ne se règle
// pas comme une personne — d'où la marque dans la liste.
function BadgeSociete({ u }: { u: Utilisateur }) {
  if (u.typeLivreur !== 'societe') return null;
  return (
    <span className="badge badge-neutral" title={u.raisonSociale ?? 'Société de livraison'}>
      Société
    </span>
  );
}

function Actions({
  u,
  className,
  onModifier,
  onBasculer,
  onTarifs,
  onMotDePasse,
  onSupprimer,
}: {
  u: Utilisateur;
  className?: string;
  onModifier: () => void;
  onBasculer: () => void;
  onTarifs: () => void;
  onMotDePasse: () => void;
  onSupprimer: () => void;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      <IconButton variant="edit" label="Modifier le rôle et l’accès" onClick={onModifier}>
        <Pencil className="h-4 w-4" />
      </IconButton>
      {u.role === 'livreur' && (
        <IconButton variant="wallet" label="Tarifs de livraison par ville" onClick={onTarifs}>
          <Wallet className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton variant="key" label="Définir un mot de passe" onClick={onMotDePasse}>
        <Key className="h-4 w-4" />
      </IconButton>
      <IconButton variant={u.actif ? 'deactivate' : 'activate'} label={u.actif ? 'Désactiver' : 'Réactiver'} onClick={onBasculer}>
        <span className={`block h-2.5 w-2.5 rounded-full ${u.actif ? 'bg-orange-600' : 'bg-green-600'}`} />
      </IconButton>
      <IconButton variant="delete" label="Supprimer" onClick={onSupprimer}>
        <Trash2 className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
