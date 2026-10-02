'use client';

import { useState } from 'react';
import { Check, Copy, Eye, LayoutGrid, Pencil, Plus, ShieldCheck, Table2, Trash2, Users } from 'lucide-react';
import { PERMISSIONS_MARCHAND, TOUTES_PERMISSIONS_MARCHAND } from '@/lib/permissions-marchand';
import type { DonneesEquipe, RoleEquipe } from './equipe-types';
import { contientTout } from './equipe-ui';
import { EditeurRoleModal, SupprimerRoleModal, type ModeEditeurRole } from './equipe-modales';

export function OngletRoles({ donnees, recharger }: { donnees: DonneesEquipe; recharger: () => void }) {
  const [vue, setVue] = useState<'cartes' | 'matrice'>('cartes');
  const [editeur, setEditeur] = useState<ModeEditeurRole | null>(null);
  const [aSupprimer, setASupprimer] = useState<RoleEquipe | null>(null);
  const peutGerer = donnees.moi.permissions.includes('equipe.gerer');

  // Même règle que le serveur (roleModifiable) : un membre délégué ne touche
  // ni au rôle qu'il porte, ni à un rôle plus large que ses droits.
  const monRoleId = donnees.membres.find((m) => m.utilisateurId === donnees.moi.utilisateurId)?.roleId;
  const modifiable = (r: RoleEquipe) =>
    peutGerer &&
    !r.systeme &&
    (donnees.moi.estTitulaire || (r.id !== monRoleId && contientTout(donnees.moi.permissions, r.permissions)));
  const duplicable = (r: RoleEquipe) =>
    peutGerer && (donnees.moi.estTitulaire || contientTout(donnees.moi.permissions, r.permissions));

  const total = TOUTES_PERMISSIONS_MARCHAND.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-black/60 dark:text-white/60">
          Un rôle regroupe des droits. Les rôles <strong>prédéfinis</strong> couvrent les besoins courants ; créez un
          rôle <strong>personnalisé</strong> pour un besoin précis, ou dupliquez un rôle existant pour l’ajuster.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {(
              [
                ['cartes', LayoutGrid, 'Cartes'],
                ['matrice', Table2, 'Comparer'],
              ] as const
            ).map(([cle, Icone, libelle]) => (
              <button
                key={cle}
                type="button"
                onClick={() => setVue(cle)}
                aria-pressed={vue === cle}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition pointer-coarse:py-2 ${
                  vue === cle
                    ? 'bg-brand text-brand-foreground'
                    : 'text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white'
                }`}
              >
                <Icone className="h-3.5 w-3.5" />
                {libelle}
              </button>
            ))}
          </div>
          {peutGerer && (
            <button type="button" className="btn-primary" onClick={() => setEditeur({ kind: 'creer' })}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nouveau rôle</span>
              <span className="sm:hidden">Rôle</span>
            </button>
          )}
        </div>
      </div>

      {vue === 'cartes' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {donnees.roles.map((r) => {
            const categories = PERMISSIONS_MARCHAND.filter((c) => c.permissions.some((p) => r.permissions.includes(p.key)));
            const pct = Math.round((r.permissions.length / total) * 100);
            return (
              <li
                key={r.id}
                className="flex flex-col rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-4 shadow-[var(--mk-shadow)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-black [overflow-wrap:anywhere]">{r.nom}</span>
                      {r.systeme ? (
                        <span className="badge badge-brand">
                          <ShieldCheck className="h-3 w-3" /> Prédéfini
                        </span>
                      ) : (
                        <span className="badge bg-sky-500/15 text-sky-700 dark:text-sky-400">Personnalisé</span>
                      )}
                    </p>
                    {r.description && (
                      <p className="mt-1 text-xs text-black/55 dark:text-white/55">{r.description}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-black/50 dark:text-white/50">
                    <span>
                      {r.permissions.length} / {total} droits
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {r.nbMembres} membre{r.nbMembres > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-1">
                  {categories.map((c) => (
                    <li
                      key={c.categorie}
                      className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-black/60 dark:bg-white/10 dark:text-white/65"
                    >
                      {c.categorie}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {modifiable(r) ? (
                    <button type="button" className="btn-outline btn-sm" onClick={() => setEditeur({ kind: 'modifier', role: r })}>
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </button>
                  ) : (
                    <button type="button" className="btn-outline btn-sm" onClick={() => setEditeur({ kind: 'voir', role: r })}>
                      <Eye className="h-3.5 w-3.5" /> Détail
                    </button>
                  )}
                  {duplicable(r) && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setEditeur({ kind: 'dupliquer', source: r })}>
                      <Copy className="h-3.5 w-3.5" /> Dupliquer
                    </button>
                  )}
                  {modifiable(r) && (
                    <button type="button" className="btn-ghost btn-sm text-red-700 dark:text-red-400" onClick={() => setASupprimer(r)}>
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        // Vue comparative : tous les droits × tous les rôles, d'un coup d'œil.
        // Première colonne figée pour garder le libellé lisible quand on fait
        // défiler les rôles au doigt.
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[12rem] bg-[color:var(--mk-card)]">Droit</th>
                  {donnees.roles.map((r) => (
                    <th key={r.id} className="min-w-[7rem] text-center">
                      <span className="block max-w-[9rem] truncate normal-case" title={r.nom}>
                        {r.nom}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS_MARCHAND.map((cat) => (
                  <MatriceCategorie key={cat.categorie} categorie={cat} roles={donnees.roles} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editeur && (
        <EditeurRoleModal mode={editeur} donnees={donnees} onClose={() => setEditeur(null)} onFait={recharger} />
      )}
      {aSupprimer && (
        <SupprimerRoleModal role={aSupprimer} donnees={donnees} onClose={() => setASupprimer(null)} onFait={recharger} />
      )}
    </div>
  );
}

function MatriceCategorie({
  categorie,
  roles,
}: {
  categorie: (typeof PERMISSIONS_MARCHAND)[number];
  roles: RoleEquipe[];
}) {
  return (
    <>
      <tr className="hover:!bg-transparent">
        <td
          colSpan={roles.length + 1}
          className="sticky left-0 bg-black/[0.025] !py-2 text-[11px] font-bold uppercase tracking-wider text-black/55 dark:bg-white/[0.04] dark:text-white/55"
        >
          {categorie.categorie}
        </td>
      </tr>
      {categorie.permissions.map((p) => (
        <tr key={p.key}>
          <td className="sticky left-0 z-10 bg-[color:var(--mk-card)] text-[13px] font-medium">{p.label}</td>
          {roles.map((r) => (
            <td key={r.id} className="text-center">
              {r.permissions.includes(p.key) ? (
                <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Accordé" />
              ) : (
                <span className="text-black/20 dark:text-white/20" aria-label="Non accordé">
                  —
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
