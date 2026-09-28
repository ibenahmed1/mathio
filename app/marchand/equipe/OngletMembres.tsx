'use client';

import { useMemo, useState } from 'react';
import { Crown, Key, Pencil, Search, Send, Timer, UserMinus, Users } from 'lucide-react';
import { apiDelete, apiPatch, apiPost } from '@/lib/api-client';
import { IconButton } from '@/components/admin/IconButton';
import type { DonneesEquipe, MembreEquipe, RoleEquipe, StatutMembre } from './equipe-types';
import { Avatar, BadgeStatut, dateCourte, depuis, raisonSansPrise } from './equipe-ui';
import { ConfirmationModal, LienActivation, ModifierMembreModal, MotDePasseModal } from './equipe-modales';
import { Modal } from '@/components/admin/Modal';

type FiltreStatut = 'tous' | 'actifs' | 'invitations' | 'bloques';

const FILTRES: [FiltreStatut, string, (s: StatutMembre) => boolean][] = [
  ['tous', 'Tous', () => true],
  ['actifs', 'Actifs', (s) => s === 'actif'],
  ['invitations', 'Invitations', (s) => s === 'invitation' || s === 'invitation_expiree'],
  ['bloques', 'Suspendus / expirés', (s) => s === 'suspendu' || s === 'expire'],
];

type Action =
  | { kind: 'modifier'; membre: MembreEquipe }
  | { kind: 'motDePasse'; membre: MembreEquipe }
  | { kind: 'suspendre'; membre: MembreEquipe }
  | { kind: 'retirer'; membre: MembreEquipe }
  | { kind: 'lien'; lien: string; nom: string };

export function OngletMembres({ donnees, recharger }: { donnees: DonneesEquipe; recharger: () => void }) {
  const [recherche, setRecherche] = useState('');
  const [filtreRole, setFiltreRole] = useState('tous');
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>('tous');
  const [action, setAction] = useState<Action | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const rolesParId = useMemo(() => new Map(donnees.roles.map((r) => [r.id, r])), [donnees.roles]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const test = FILTRES.find(([k]) => k === filtreStatut)?.[2] ?? (() => true);
    return donnees.membres.filter((m) => {
      if (filtreRole !== 'tous' && m.roleId !== filtreRole) return false;
      if (!test(m.statut)) return false;
      if (!q) return true;
      return [m.nomComplet, m.email ?? '', m.poste ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [donnees.membres, recherche, filtreRole, filtreStatut]);

  async function renvoyerInvitation(m: MembreEquipe) {
    setErreur(null);
    setEnCours(m.id);
    try {
      const res = await apiPost<{ emailEnvoye: boolean; lienActivation?: string }>(
        `/api/marchands/equipe/membres/${m.id}/invitation`
      );
      recharger();
      if (res.lienActivation) setAction({ kind: 'lien', lien: res.lienActivation, nom: m.nomComplet });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(null);
    }
  }

  const titulaire = donnees.titulaire;
  const filtreActif = recherche.trim() !== '' || filtreRole !== 'tous' || filtreStatut !== 'tous';

  return (
    <div className="flex flex-col gap-4">
      {/* Barre d'outils : recherche pleine largeur au doigt, filtres dessous. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            className="input-basic w-full pl-9"
            placeholder="Rechercher (nom, email, poste)…"
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
            {donnees.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom}
              </option>
            ))}
          </select>
          <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {FILTRES.map(([cle, libelle, test]) => {
              const n = donnees.membres.filter((m) => test(m.statut)).length;
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

      {/* Le titulaire, épinglé : il n'est pas un membre (aucune action ne le
          vise), mais une équipe sans son responsable se lit mal. */}
      {titulaire && !filtreActif && (
        <div className="flex flex-col gap-3 rounded-2xl border border-brand/40 bg-brand/[0.08] p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar nom={titulaire.nomComplet} graine={titulaire.id} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="truncate">{titulaire.nomComplet}</span>
                <span className="badge badge-brand">
                  <Crown className="h-3 w-3" /> Titulaire
                </span>
                {titulaire.id === donnees.moi.utilisateurId && <span className="badge badge-neutral">Vous</span>}
              </p>
              <p className="truncate text-xs text-black/55 dark:text-white/55">
                {titulaire.email ?? titulaire.telephone ?? '—'}
              </p>
            </div>
          </div>
          <p className="text-xs text-black/55 sm:text-right dark:text-white/55">
            Tous les droits, non modifiables
            <span className="block">Dernière connexion : {depuis(titulaire.derniereConnexion)}</span>
          </p>
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <Users className="mb-1 h-8 w-8 opacity-40" />
            {donnees.membres.length === 0 ? (
              <>
                <p className="font-semibold text-black/70 dark:text-white/70">Aucun membre pour le moment</p>
                <p>Invitez un collaborateur et choisissez précisément ce qu’il pourra faire.</p>
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
            {visibles.map((m) => (
              <li
                key={m.id}
                className="rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-4 shadow-[var(--mk-shadow)]"
              >
                <div className="flex items-start gap-3">
                  <Avatar nom={m.nomComplet} graine={m.utilisateurId} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                      <span className="[overflow-wrap:anywhere]">{m.nomComplet}</span>
                      {m.utilisateurId === donnees.moi.utilisateurId && <span className="badge badge-neutral">Vous</span>}
                    </p>
                    <p className="text-xs text-black/55 [overflow-wrap:anywhere] dark:text-white/55">{m.email}</p>
                    {m.poste && <p className="text-xs text-black/45 dark:text-white/45">{m.poste}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RoleChip role={rolesParId.get(m.roleId)} />
                  <BadgeStatut statut={m.statut} />
                  <Echeance membre={m} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-black/45 dark:text-white/45">Dernière connexion</dt>
                    <dd className="font-semibold">{depuis(m.derniereConnexion)}</dd>
                  </div>
                  <div>
                    <dt className="text-black/45 dark:text-white/45">Ajouté le</dt>
                    <dd className="font-semibold">{dateCourte(m.dateAjout)}</dd>
                  </div>
                </dl>
                <Actions
                  membre={m}
                  raison={raisonSansPrise(donnees, m, rolesParId)}
                  enCours={enCours === m.id}
                  onAction={setAction}
                  onRenvoyer={renvoyerInvitation}
                  className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/10"
                />
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
                  {visibles.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar nom={m.nomComplet} graine={m.utilisateurId} taille="sm" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-semibold">
                              <span className="max-w-[16rem] truncate">{m.nomComplet}</span>
                              {m.utilisateurId === donnees.moi.utilisateurId && (
                                <span className="badge badge-neutral">Vous</span>
                              )}
                            </p>
                            <p className="max-w-[18rem] truncate text-xs text-black/50 dark:text-white/50">
                              {m.email}
                              {m.poste && <> · {m.poste}</>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <RoleChip role={rolesParId.get(m.roleId)} />
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <BadgeStatut statut={m.statut} />
                          <Echeance membre={m} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-black/70 dark:text-white/70">{depuis(m.derniereConnexion)}</td>
                      {/* Masquée sous 1536 px : l'information reste dans le journal. */}
                      <td
                        className="hidden whitespace-nowrap text-xs text-black/55 2xl:table-cell dark:text-white/55"
                        title={m.ajoutePar ? `Ajouté par ${m.ajoutePar}` : undefined}
                      >
                        {dateCourte(m.dateAjout)}
                      </td>
                      <td className="cell-actions">
                        <Actions
                          membre={m}
                          raison={raisonSansPrise(donnees, m, rolesParId)}
                          enCours={enCours === m.id}
                          onAction={setAction}
                          onRenvoyer={renvoyerInvitation}
                          className="justify-end !flex-nowrap"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {action?.kind === 'modifier' && (
        <ModifierMembreModal donnees={donnees} membre={action.membre} onClose={() => setAction(null)} onFait={recharger} />
      )}
      {action?.kind === 'motDePasse' && (
        <MotDePasseModal membre={action.membre} onClose={() => setAction(null)} onFait={recharger} />
      )}
      {action?.kind === 'suspendre' && (
        <ConfirmationModal
          titre={action.membre.statut === 'suspendu' ? 'Réactiver l’accès' : 'Suspendre l’accès'}
          libelle={action.membre.statut === 'suspendu' ? 'Réactiver' : 'Suspendre'}
          danger={action.membre.statut !== 'suspendu'}
          onClose={() => setAction(null)}
          onConfirmer={async () => {
            await apiPatch(`/api/marchands/equipe/membres/${action.membre.id}`, {
              actif: action.membre.statut === 'suspendu',
            });
            recharger();
          }}
        >
          {action.membre.statut === 'suspendu' ? (
            <p>
              <strong>{action.membre.nomComplet}</strong> pourra de nouveau se connecter, avec les droits de son rôle.
            </p>
          ) : (
            <p>
              <strong>{action.membre.nomComplet}</strong> sera déconnecté immédiatement et ne pourra plus se connecter
              tant que vous ne l’aurez pas réactivé. Son compte et son historique sont conservés.
            </p>
          )}
        </ConfirmationModal>
      )}
      {action?.kind === 'retirer' && (
        <ConfirmationModal
          titre="Retirer de l’équipe"
          libelle="Retirer définitivement"
          danger
          onClose={() => setAction(null)}
          onConfirmer={async () => {
            await apiDelete(`/api/marchands/equipe/membres/${action.membre.id}`);
            recharger();
          }}
        >
          <p>
            <strong>{action.membre.nomComplet}</strong> perdra immédiatement tout accès à la boutique. Les actions déjà
            réalisées restent tracées à son nom, et vous pourrez le réinviter plus tard avec le même email.
          </p>
          <p className="mt-2 text-xs text-black/55 dark:text-white/55">
            Pour une absence temporaire, préférez « Suspendre ».
          </p>
        </ConfirmationModal>
      )}
      {action?.kind === 'lien' && (
        <Modal title={`Invitation renvoyée — ${action.nom}`} onClose={() => setAction(null)} size="md">
          <LienActivation lien={action.lien} />
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={() => setAction(null)}>
              Terminé
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RoleChip({ role }: { role?: RoleEquipe }) {
  if (!role) return <span className="text-xs opacity-50">—</span>;
  return (
    <span
      className="inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-semibold shadow-sm dark:border-white/15 dark:bg-white/5"
      title={role.description ?? undefined}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${role.systeme ? 'bg-brand' : 'bg-sky-500'}`} />
      <span className="truncate">{role.nom}</span>
    </span>
  );
}

// Échéance à surveiller : fin d'un accès temporaire, ou d'un lien d'invitation.
function Echeance({ membre }: { membre: MembreEquipe }) {
  if (membre.statut === 'invitation' && membre.invitationExpireLe) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-black/50 dark:text-white/50">
        <Send className="h-3 w-3" /> Lien valable jusqu’au {dateCourte(membre.invitationExpireLe)}
      </span>
    );
  }
  if (membre.accesExpireLe && membre.statut === 'actif') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
        <Timer className="h-3 w-3" /> Jusqu’au {dateCourte(membre.accesExpireLe)}
      </span>
    );
  }
  return null;
}

function Actions({
  membre,
  raison,
  enCours,
  onAction,
  onRenvoyer,
  className,
}: {
  membre: MembreEquipe;
  raison: string | null;
  enCours: boolean;
  onAction: (a: Action) => void;
  onRenvoyer: (m: MembreEquipe) => void;
  className?: string;
}) {
  if (raison) {
    return (
      <p className={`flex text-[11px] text-black/40 dark:text-white/40 ${className ?? ''}`} title={raison}>
        <span className="max-w-[14rem] whitespace-normal text-left md:text-right">{raison}</span>
      </p>
    );
  }
  const enAttente = membre.statut === 'invitation' || membre.statut === 'invitation_expiree';
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {enAttente && (
        <IconButton variant="add" label="Renvoyer l’invitation" onClick={() => onRenvoyer(membre)} disabled={enCours}>
          <Send className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton variant="edit" label="Modifier le rôle et l’accès" onClick={() => onAction({ kind: 'modifier', membre })}>
        <Pencil className="h-4 w-4" />
      </IconButton>
      <IconButton variant="key" label="Définir un mot de passe" onClick={() => onAction({ kind: 'motDePasse', membre })}>
        <Key className="h-4 w-4" />
      </IconButton>
      <IconButton
        variant={membre.statut === 'suspendu' ? 'activate' : 'deactivate'}
        label={membre.statut === 'suspendu' ? 'Réactiver' : 'Suspendre'}
        onClick={() => onAction({ kind: 'suspendre', membre })}
      >
        <span className={`block h-2.5 w-2.5 rounded-full ${membre.statut === 'suspendu' ? 'bg-green-600' : 'bg-orange-600'}`} />
      </IconButton>
      <IconButton variant="delete" label="Retirer de l’équipe" onClick={() => onAction({ kind: 'retirer', membre })}>
        <UserMinus className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
