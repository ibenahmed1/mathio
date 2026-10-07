'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Eye, LayoutGrid, Pencil, Plus, ShieldCheck, Table2, Trash2, Truck, Users } from 'lucide-react';
import { apiDelete, apiPatch, apiPost } from '@/lib/api-client';
import { ALL_PERMISSIONS, PERMISSION_CATALOG } from '@/lib/permissions';
import { estFonctionTerrain, nomFonction } from '@/lib/fonctions-equipe';
import {
  FONCTIONS_ROLE_PERSONNALISE,
  LONGUEUR_MAX_DESCRIPTION_ROLE,
  LONGUEUR_MAX_NOM_ROLE,
  type RoleBackofficeExpose,
} from '@/lib/roles-backoffice';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';

// Onglet Rôles & permissions de l'écran Équipe & rôles : même construction que
// l'onglet Rôles de l'équipe marchande (app/marchand/equipe/OngletRoles.tsx) —
// cartes ou matrice, création, modification, duplication, suppression.
//
// Différences de fond (décision du 07/10/2026) :
//   · un rôle repose sur une FONCTION technique (Superviseur, Responsable…),
//     celle que vérifient les routes de l'API ;
//   · les rôles PRÉDÉFINIS se modifient (description, droits) mais ne se
//     suppriment pas ;
//   · un rôle pré-coche les droits du compte quand on le lui attribue — les
//     comptes déjà attribués ne changent pas quand on modifie le rôle.

type ModeEditeur =
  | { kind: 'creer' }
  | { kind: 'dupliquer'; source: RoleBackofficeExpose }
  | { kind: 'modifier'; role: RoleBackofficeExpose }
  | { kind: 'voir'; role: RoleBackofficeExpose };

export function OngletFonctions({ roles, recharger }: { roles: RoleBackofficeExpose[]; recharger: () => void }) {
  const [vue, setVue] = useState<'cartes' | 'matrice'>('cartes');
  const [editeur, setEditeur] = useState<ModeEditeur | null>(null);
  const [aSupprimer, setASupprimer] = useState<RoleBackofficeExpose | null>(null);
  const total = ALL_PERMISSIONS.length;
  const backOffice = roles.filter((r) => !estFonctionTerrain(r.fonction));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-black/60 dark:text-white/60">
          Un rôle regroupe des droits sur une fonction. Les rôles <strong>prédéfinis</strong> couvrent les besoins
          courants et se modifient ; créez un rôle <strong>personnalisé</strong> pour un besoin précis, ou dupliquez un
          rôle existant pour l’ajuster. Le rôle pré-coche les droits d’un compte, ajustables ensuite dans sa fiche.
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
          <button type="button" className="btn-primary" onClick={() => setEditeur({ kind: 'creer' })}>
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nouveau rôle</span>
            <span className="sm:hidden">Rôle</span>
          </button>
        </div>
      </div>

      {vue === 'cartes' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => {
            const terrain = estFonctionTerrain(r.fonction);
            const categories = PERMISSION_CATALOG.filter((c) => c.permissions.some((p) => r.permissions.includes(p.key)));
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
                      {terrain ? (
                        <span className="badge bg-sky-500/15 text-sky-700 dark:text-sky-400">
                          <Truck className="h-3 w-3" /> Terrain
                        </span>
                      ) : r.predefini ? (
                        <span className="badge badge-brand">
                          <ShieldCheck className="h-3 w-3" /> Prédéfini
                        </span>
                      ) : (
                        <span className="badge bg-sky-500/15 text-sky-700 dark:text-sky-400">Personnalisé</span>
                      )}
                    </p>
                    {!r.predefini && (
                      <p className="mt-0.5 text-[11px] font-semibold text-black/45 dark:text-white/45">
                        Fonction : {nomFonction(r.fonction)}
                      </p>
                    )}
                    {r.description && <p className="mt-1 text-xs text-black/55 dark:text-white/55">{r.description}</p>}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-black/50 dark:text-white/50">
                    <span>{terrain ? 'Espace terrain' : `${r.permissions.length} / ${total} droits`}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {r.nbMembres} membre{r.nbMembres > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${terrain ? 0 : pct}%` }} />
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-1">
                  {terrain ? (
                    <li className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-black/60 dark:bg-white/10 dark:text-white/65">
                      Accès défini par le rôle
                    </li>
                  ) : (
                    categories.map((c) => (
                      <li
                        key={c.category}
                        className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-black/60 dark:bg-white/10 dark:text-white/65"
                      >
                        {c.category}
                      </li>
                    ))
                  )}
                </ul>

                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {terrain ? (
                    <button type="button" className="btn-outline btn-sm" onClick={() => setEditeur({ kind: 'voir', role: r })}>
                      <Eye className="h-3.5 w-3.5" /> Détail
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn-outline btn-sm" onClick={() => setEditeur({ kind: 'modifier', role: r })}>
                        <Pencil className="h-3.5 w-3.5" /> Modifier
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditeur({ kind: 'dupliquer', source: r })}>
                        <Copy className="h-3.5 w-3.5" /> Dupliquer
                      </button>
                    </>
                  )}
                  {!r.predefini && (
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
        // Vue comparative : tous les droits × tous les rôles du back-office.
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[12rem] bg-[color:var(--mk-card)]">Droit</th>
                  {backOffice.map((r) => (
                    <th key={r.id} className="min-w-[7rem] text-center">
                      <span className="block max-w-[9rem] truncate normal-case" title={r.nom}>
                        {r.nom}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_CATALOG.map((cat) => (
                  <MatriceCategorie key={cat.category} categorie={cat} roles={backOffice} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editeur && <EditeurRole mode={editeur} onClose={() => setEditeur(null)} onFait={recharger} />}
      {aSupprimer && <SupprimerRole role={aSupprimer} onClose={() => setASupprimer(null)} onFait={recharger} />}
    </div>
  );
}

function MatriceCategorie({
  categorie,
  roles,
}: {
  categorie: (typeof PERMISSION_CATALOG)[number];
  roles: RoleBackofficeExpose[];
}) {
  return (
    <>
      <tr className="hover:!bg-transparent">
        <td
          colSpan={roles.length + 1}
          className="sticky left-0 bg-black/[0.025] !py-2 text-[11px] font-bold uppercase tracking-wider text-black/55 dark:bg-white/[0.04] dark:text-white/55"
        >
          {categorie.category}
        </td>
      </tr>
      {categorie.permissions.map((p) => (
        <tr key={p.key}>
          <td className="sticky left-0 z-10 bg-[color:var(--mk-card)] text-[13px] font-medium" title={p.description}>
            {p.label}
          </td>
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

// --- Éditeur de rôle --------------------------------------------------------

function EditeurRole({ mode, onClose, onFait }: { mode: ModeEditeur; onClose: () => void; onFait: () => void }) {
  const initial = useMemo(() => {
    if (mode.kind === 'creer') return { nom: '', description: '', fonction: 'superviseur', permissions: ['dashboard:view'] };
    if (mode.kind === 'dupliquer') {
      return {
        nom: `${mode.source.nom} (copie)`,
        description: mode.source.description ?? '',
        fonction: estFonctionTerrain(mode.source.fonction) ? 'superviseur' : mode.source.fonction,
        permissions: mode.source.permissions,
      };
    }
    return {
      nom: mode.role.nom,
      description: mode.role.description ?? '',
      fonction: mode.role.fonction,
      permissions: mode.role.permissions,
    };
  }, [mode]);
  const [form, setForm] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const lectureSeule = mode.kind === 'voir';
  const predefini = mode.kind === 'modifier' && mode.role.predefini;

  const titre =
    mode.kind === 'creer'
      ? 'Nouveau rôle'
      : mode.kind === 'dupliquer'
        ? `Dupliquer « ${mode.source.nom} »`
        : mode.kind === 'modifier'
          ? `Modifier « ${mode.role.nom} »`
          : mode.role.nom;

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    if (lectureSeule) return;
    setErreur(null);
    setEnvoi(true);
    try {
      if (mode.kind === 'modifier') {
        // Un prédéfini garde son nom et sa fonction : on ne les envoie pas.
        const corps = predefini
          ? { description: form.description, permissions: form.permissions }
          : form;
        await apiPatch(`/api/utilisateurs/roles/${mode.role.id}`, corps);
      } else {
        await apiPost('/api/utilisateurs/roles', form);
      }
      onFait();
      onClose();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal title={titre} onClose={onClose} size="lg">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        {predefini && (
          <p className="flex items-start gap-2 rounded-xl bg-brand/[0.12] px-3 py-2 text-[13px]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Rôle prédéfini : son nom et sa fonction sont fixes, ses droits se modifient. Les comptes qui portent déjà ce
            rôle gardent leurs droits actuels ; les nouveaux recevront ceux-ci.
          </p>
        )}
        {lectureSeule ? (
          <p className="rounded-xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] px-4 py-3 text-[13px] text-[color:var(--mk-ink-2)]">
            Rôle de l’espace terrain : son accès est entièrement défini par le rôle (ses tournées, ses ramassages, ses
            bons), sans droits du back-office à cocher.
          </p>
        ) : (
          <div className="form-grid">
            <Field label="Nom du rôle" required={!predefini}>
              <input
                className="input-basic"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                maxLength={LONGUEUR_MAX_NOM_ROLE}
                placeholder="Ex. Superviseur statistiques"
                required={!predefini}
                disabled={predefini}
                autoFocus={!predefini}
              />
            </Field>
            <Field label="Fonction de base" required={!predefini}>
              <select
                className="input-basic"
                value={form.fonction}
                onChange={(e) => setForm({ ...form, fonction: e.target.value })}
                disabled={predefini}
              >
                {FONCTIONS_ROLE_PERSONNALISE.map((f) => (
                  <option key={f} value={f}>
                    {nomFonction(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" optional>
              <input
                className="input-basic"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={LONGUEUR_MAX_DESCRIPTION_ROLE}
                placeholder="À quoi sert ce rôle ?"
              />
            </Field>
          </div>
        )}

        {!lectureSeule && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="form-subtitle">Permissions</span>
              <span className="text-xs text-black/50 dark:text-white/50">
                {form.permissions.length} droit{form.permissions.length > 1 ? 's' : ''}
              </span>
            </div>
            <p className="-mt-2 text-xs text-black/50 dark:text-white/50">
              La fonction de base décide des actions sensibles (payer, clôturer…) ; ces droits décident des écrans
              ouverts.
            </p>
            <GrillePermissionsAdmin valeur={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
          </>
        )}

        {erreur && <p className="form-error">{erreur}</p>}
        <div className="form-actions sticky -bottom-5 -mx-5 -mb-5 border-t border-black/[0.06] bg-white/95 px-5 py-3 backdrop-blur dark:border-white/10 dark:bg-neutral-950/95">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {lectureSeule ? 'Fermer' : 'Annuler'}
          </button>
          {!lectureSeule && (
            <button type="submit" className="btn-primary" disabled={envoi || form.permissions.length === 0}>
              {envoi ? 'Enregistrement…' : mode.kind === 'modifier' ? 'Enregistrer' : 'Créer le rôle'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// Même grille que l'éditeur de rôle marchand (GrillePermissions), sur le
// catalogue du back-office.
function GrillePermissionsAdmin({ valeur, onChange }: { valeur: string[]; onChange: (v: string[]) => void }) {
  const set = new Set(valeur);
  const basculer = (key: string) => onChange(set.has(key) ? valeur.filter((k) => k !== key) : [...valeur, key]);
  const basculerCategorie = (keys: string[], toutCoche: boolean) =>
    onChange(toutCoche ? valeur.filter((k) => !keys.includes(k)) : Array.from(new Set([...valeur, ...keys])));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PERMISSION_CATALOG.map((cat) => {
        const keys = cat.permissions.map((p) => p.key);
        const nbCoches = keys.filter((k) => set.has(k)).length;
        const toutCoche = nbCoches === keys.length;
        return (
          <fieldset
            key={cat.category}
            className="flex flex-col rounded-xl border border-black/[0.08] bg-black/[0.015] dark:border-white/10 dark:bg-white/[0.02]"
          >
            <legend className="sr-only">{cat.category}</legend>
            <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/10">
              <span className="text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                {cat.category}
                <span className="ml-1.5 font-semibold normal-case tracking-normal text-black/40 dark:text-white/40">
                  {nbCoches}/{keys.length}
                </span>
              </span>
              <button
                type="button"
                className="text-[11px] font-bold text-black/50 underline-offset-2 hover:text-black hover:underline pointer-coarse:py-2 dark:text-white/50 dark:hover:text-white"
                onClick={() => basculerCategorie(keys, toutCoche)}
              >
                {toutCoche ? 'Tout retirer' : 'Tout cocher'}
              </button>
            </div>
            <ul className="flex flex-col p-1">
              {cat.permissions.map((p) => (
                <li key={p.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-brand/[0.08]">
                    <input type="checkbox" className="check-basic mt-0.5" checked={set.has(p.key)} onChange={() => basculer(p.key)} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">{p.label}</span>
                      <span className="block text-xs text-black/50 dark:text-white/50">{p.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

// --- Suppression d'un rôle --------------------------------------------------

function SupprimerRole({ role, onClose, onFait }: { role: RoleBackofficeExpose; onClose: () => void; onFait: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  async function confirmer() {
    setErreur(null);
    setEnvoi(true);
    try {
      await apiDelete(`/api/utilisateurs/roles/${role.id}`);
      onFait();
      onClose();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal title={`Supprimer le rôle « ${role.nom} »`} onClose={onClose} size="md">
      {role.nbMembres > 0 ? (
        <p className="text-sm">
          Ce rôle est attribué à{' '}
          <strong>
            {role.nbMembres} membre{role.nbMembres > 1 ? 's' : ''}
          </strong>
          . Ils passeront sur le rôle prédéfini <strong>{nomFonction(role.fonction)}</strong> — même fonction, et leurs
          droits actuels sont conservés.
        </p>
      ) : (
        <p className="text-sm">Ce rôle n’est attribué à personne. Sa suppression est définitive.</p>
      )}
      {erreur && <p className="form-error mt-3">{erreur}</p>}
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn-danger" onClick={confirmer} disabled={envoi}>
          {envoi ? 'Suppression…' : 'Supprimer le rôle'}
        </button>
      </div>
    </Modal>
  );
}
