'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import type { EquipeTache, MembreTache } from '@/lib/types';
import { EQUIPE_COULEUR_LABEL, labelClassName } from '@/lib/statuts';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';

const ROLE_LABELS_EQUIPE: Record<string, string> = {
  admin: 'Administrateur',
  superviseur: 'Superviseur',
  moderateur: 'Modérateur',
  equipe_suivi: 'Agent',
  responsable: 'Responsable',
};

const ROLES_INVITATION = ['equipe_suivi', 'admin', 'superviseur', 'moderateur', 'responsable'];

// Palette des pôles : les clés de EQUIPE_COULEUR_LABEL, seules valeurs
// acceptées côté API (POST/PATCH /api/taches/equipes). Deux clés (`emerald` et
// `gray`) retombent sur le même chip `docs` — on n'en propose qu'une au choix
// pour ne pas afficher deux options visuellement identiques, l'autre restant
// acceptée par l'API pour les pôles existants.
const COULEURS = Object.keys(EQUIPE_COULEUR_LABEL).filter(
  (c, i, tous) => tous.findIndex((autre) => EQUIPE_COULEUR_LABEL[autre] === EQUIPE_COULEUR_LABEL[c]) === i
);

type Mode = 'membres' | 'creation' | 'edition' | 'suppression';

// Gestion des pôles (§ /admin/tasks). Deux niveaux de droits :
//   - composition (cocher/décocher des membres, inviter) : tout le back-office
//     hors rôles Kanban-only ;
//   - cycle de vie du pôle (créer, renommer, recolorer, supprimer) : admin
//     seul — d'où `peutGererPoles`, qui masque ces commandes pour les autres.
export function TeamManagerModal({
  equipes,
  personnelInterne,
  peutGererPoles = false,
  onClose,
  onChanged,
}: {
  equipes: EquipeTache[];
  personnelInterne: MembreTache[];
  peutGererPoles?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [equipeId, setEquipeId] = useState(equipes[0]?.id ?? '');
  const equipe = useMemo(() => equipes.find((eq) => eq.id === equipeId), [equipes, equipeId]);

  const [mode, setMode] = useState<Mode>('membres');
  const [selection, setSelection] = useState<Set<string>>(
    () => new Set((equipes[0]?.membres ?? []).map((m) => m.utilisateur.id))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Formulaire création/édition de pôle
  const [poleForm, setPoleForm] = useState({ nom: '', code: '', couleur: 'blue' });
  const [transfertVers, setTransfertVers] = useState('');

  // Invitation
  const [inviteOuvert, setInviteOuvert] = useState(false);
  const [inviteForm, setInviteForm] = useState({ nomComplet: '', email: '', role: 'equipe_suivi' });
  // Par défaut on envoie un lien d'activation : après le déploiement, l'invitant
  // n'a plus à inventer ni transmettre un mot de passe. Le mode « mot de passe »
  // reste là pour les cas sans SMTP ou en présentiel.
  const [avecMotDePasse, setAvecMotDePasse] = useState(false);
  const [inviteSecret, setInviteSecret] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lienInvitation, setLienInvitation] = useState<string | null>(null);
  const [lienCopie, setLienCopie] = useState(false);

  // La liste des pôles est rechargée par le parent : quand l'équipe courante
  // disparaît (suppression) ou vient d'être créée, on se recale dessus.
  useEffect(() => {
    queueMicrotask(() => {
      if (equipes.length === 0) {
        setEquipeId('');
        setSelection(new Set());
        return;
      }
      if (!equipes.some((eq) => eq.id === equipeId)) {
        const premiere = equipes[0];
        setEquipeId(premiere.id);
        setSelection(new Set((premiere.membres ?? []).map((m) => m.utilisateur.id)));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipes]);

  function reinitialiserEtat() {
    setError(null);
    setInfo(null);
    setInviteOuvert(false);
    setLienInvitation(null);
    setLienCopie(false);
    setMode('membres');
  }

  function selectionnerEquipe(id: string) {
    setEquipeId(id);
    const eq = equipes.find((e) => e.id === id);
    setSelection(new Set((eq?.membres ?? []).map((m) => m.utilisateur.id)));
    reinitialiserEtat();
  }

  function ouvrirCreation() {
    setPoleForm({ nom: '', code: '', couleur: 'blue' });
    setError(null);
    setInfo(null);
    setMode('creation');
  }

  function ouvrirEdition() {
    if (!equipe) return;
    setPoleForm({ nom: equipe.nom, code: equipe.code, couleur: equipe.couleur });
    setError(null);
    setInfo(null);
    setMode('edition');
  }

  function ouvrirSuppression() {
    setTransfertVers('');
    setError(null);
    setInfo(null);
    setMode('suppression');
  }

  function toggle(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function enregistrerMembres() {
    if (!equipeId) return;
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/api/taches/equipes/${equipeId}/membres`, { utilisateurIds: Array.from(selection) });
      setInfo('Composition enregistrée');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function creerPole(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // `code` optionnel : l'API le dérive du nom quand il est vide, pour
      // éviter une double saisie au cas courant.
      const cree = await apiPost<EquipeTache>('/api/taches/equipes', poleForm);
      setEquipeId(cree.id);
      setSelection(new Set());
      setMode('membres');
      setInfo(`Pôle « ${cree.nom} » créé`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function modifierPole(e: React.FormEvent) {
    e.preventDefault();
    if (!equipeId) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/taches/equipes/${equipeId}`, poleForm);
      setMode('membres');
      setInfo('Pôle mis à jour');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function supprimerPole() {
    if (!equipeId) return;
    setSaving(true);
    setError(null);
    try {
      const qs = transfertVers ? `?transfererVers=${transfertVers}` : '';
      await apiDelete(`/api/taches/equipes/${equipeId}${qs}`);
      setMode('membres');
      setInfo('Pôle supprimé');
      onChanged();
    } catch (err) {
      // 409 quand des tâches restent rattachées : le message de l'API donne
      // leur nombre, l'utilisateur choisit alors un pôle de destination sans
      // quitter l'écran.
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    if (!equipeId) return;
    setInviting(true);
    setError(null);
    setInfo(null);
    setLienInvitation(null);
    try {
      const reponse = await apiPost<{
        utilisateur: { id: string };
        mode: 'rattachement' | 'mot_de_passe_defini' | 'invitation';
        emailEnvoye?: boolean;
        lienActivation?: string;
      }>(`/api/taches/equipes/${equipeId}/membres`, {
        ...inviteForm,
        secret: avecMotDePasse ? inviteSecret : undefined,
      });

      setSelection((prev) => new Set(prev).add(reponse.utilisateur.id));
      setInviteForm({ nomComplet: '', email: '', role: 'equipe_suivi' });
      setInviteSecret('');

      if (reponse.mode === 'rattachement') {
        setInfo('Ce compte existait déjà : il a été rattaché au pôle.');
        setInviteOuvert(false);
      } else if (reponse.mode === 'mot_de_passe_defini') {
        setInfo('Compte créé. Communiquez le mot de passe à la personne.');
        setInviteOuvert(false);
      } else if (reponse.emailEnvoye) {
        setInfo('Invitation envoyée par email (lien valable 7 jours).');
        setInviteOuvert(false);
      } else {
        // SMTP non configuré : sans ce lien, le compte créé serait inutilisable.
        setLienInvitation(reponse.lienActivation ?? null);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setInviting(false);
    }
  }

  async function copierLien() {
    if (!lienInvitation) return;
    try {
      await navigator.clipboard.writeText(lienInvitation);
      setLienCopie(true);
    } catch {
      setLienCopie(false);
    }
  }

  // Le personnel invité via ce modal n'est pas toujours revenu dans
  // `personnelInterne` (chargé au montage de la page) tant que onChanged()
  // n'a pas rechargé les données parentes — on complète localement avec les
  // membres déjà connus de l'équipe pour que la case cochée reste visible.
  const personnesAffichees = useMemo(() => {
    const parIds = new Map(personnelInterne.map((p) => [p.id, p]));
    for (const m of equipe?.membres ?? []) {
      if (!parIds.has(m.utilisateur.id)) {
        parIds.set(m.utilisateur.id, {
          id: m.utilisateur.id,
          nomComplet: m.utilisateur.nomComplet,
          role: m.utilisateur.role,
        });
      }
    }
    return Array.from(parIds.values()).sort((a, b) => a.nomComplet.localeCompare(b.nomComplet));
  }, [personnelInterne, equipe]);

  const autresPoles = equipes.filter((eq) => eq.id !== equipeId);

  const titre =
    mode === 'creation' ? 'Nouveau pôle' : mode === 'edition' ? 'Modifier le pôle' : 'Gérer les équipes';

  return (
    <Modal title={titre} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {mode === 'creation' || mode === 'edition' ? (
          <form onSubmit={mode === 'creation' ? creerPole : modifierPole} className="flex flex-col gap-3">
            <Field label="Nom du pôle" required>
              <input
                className="input-basic"
                autoFocus
                placeholder="Développement"
                value={poleForm.nom}
                onChange={(e) => setPoleForm({ ...poleForm, nom: e.target.value })}
                required
              />
            </Field>
            <Field label="Code">
              <input
                className="input-basic"
                placeholder={mode === 'creation' ? 'déduit du nom si laissé vide' : ''}
                value={poleForm.code}
                onChange={(e) => setPoleForm({ ...poleForm, code: e.target.value })}
                required={mode === 'edition'}
              />
              <span className="text-xs opacity-50">Identifiant court et unique (minuscules, sans espaces).</span>
            </Field>
            <div className="flex flex-col gap-1.5 text-sm font-medium">
              Couleur
              {/* Le rendu réel du chip d'équipe, pas une pastille abstraite :
                  la charte étant monochrome (jaune/gris), des ronds de couleur
                  seraient indistinguables les uns des autres. */}
              <div className="flex flex-wrap gap-2">
                {COULEURS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPoleForm({ ...poleForm, couleur: c })}
                    aria-label={`Couleur ${c}`}
                    aria-pressed={poleForm.couleur === c}
                    className={`kdc-label ${labelClassName(EQUIPE_COULEUR_LABEL[c])} rounded-full border-2 transition ${
                      poleForm.couleur === c ? 'border-black dark:border-white' : 'border-transparent'
                    }`}
                  >
                    {poleForm.nom.trim() || 'Aperçu'}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
              <button type="button" className="btn-outline" onClick={reinitialiserEtat} disabled={saving}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Enregistrement…' : mode === 'creation' ? 'Créer le pôle' : 'Enregistrer'}
              </button>
            </div>
          </form>
        ) : mode === 'suppression' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Supprimer le pôle <strong>{equipe?.nom}</strong> ? Les comptes de ses membres sont conservés ; seul
              leur rattachement à ce pôle disparaît.
            </p>
            <Field label="Transférer ses tâches vers">
              <select className="input-basic" value={transfertVers} onChange={(e) => setTransfertVers(e.target.value)}>
                <option value="">Aucun (échoue si le pôle porte des tâches)</option>
                {autresPoles.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.nom}
                  </option>
                ))}
              </select>
            </Field>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
              <button type="button" className="btn-outline" onClick={reinitialiserEtat} disabled={saving}>
                Annuler
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                onClick={supprimerPole}
                disabled={saving}
              >
                {saving ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <Field label="Équipe" className="flex-1">
                <select
                  className="input-basic"
                  value={equipeId}
                  onChange={(e) => selectionnerEquipe(e.target.value)}
                  disabled={equipes.length === 0}
                >
                  {equipes.length === 0 && <option value="">Aucun pôle</option>}
                  {equipes.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.nom}
                    </option>
                  ))}
                </select>
              </Field>
              {peutGererPoles && (
                <div className="flex gap-1 pb-0.5">
                  <button type="button" onClick={ouvrirCreation} title="Créer un pôle" className="btn-outline px-2 py-2">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={ouvrirEdition}
                    title="Modifier le pôle"
                    disabled={!equipeId}
                    className="btn-outline px-2 py-2 disabled:opacity-40"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={ouvrirSuppression}
                    title="Supprimer le pôle"
                    disabled={!equipeId}
                    className="btn-outline px-2 py-2 text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide opacity-60">
                <Users className="h-3.5 w-3.5" /> Membres du pôle
              </p>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-black/10 p-1.5 dark:border-white/10">
                {personnesAffichees.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={selection.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={!equipeId}
                    />
                    <span className="flex-1">{p.nomComplet}</span>
                    <span className="text-xs opacity-50">{ROLE_LABELS_EQUIPE[p.role] ?? p.role}</span>
                  </label>
                ))}
                {personnesAffichees.length === 0 && (
                  <p className="px-2 py-3 text-center text-xs opacity-50">Aucun compte back-office pour le moment</p>
                )}
              </div>
            </div>

            {inviteOuvert ? (
              <form
                onSubmit={inviter}
                className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide opacity-60">Inviter un membre</p>
                  <button type="button" onClick={() => setInviteOuvert(false)} className="opacity-60 hover:opacity-100">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="input-basic"
                  placeholder="Nom complet"
                  value={inviteForm.nomComplet}
                  onChange={(e) => setInviteForm({ ...inviteForm, nomComplet: e.target.value })}
                  required
                />
                <input
                  className="input-basic"
                  type="email"
                  placeholder="Email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  required
                />
                <select
                  className="input-basic"
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                >
                  {ROLES_INVITATION.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS_EQUIPE[r]}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand"
                    checked={avecMotDePasse}
                    onChange={(e) => setAvecMotDePasse(e.target.checked)}
                  />
                  Définir moi-même le mot de passe (sinon : lien d’activation par email)
                </label>
                {avecMotDePasse && (
                  <input
                    className="input-basic"
                    type="password"
                    placeholder="Mot de passe (8+ car., maj/chiffre/spécial)"
                    minLength={8}
                    value={inviteSecret}
                    onChange={(e) => setInviteSecret(e.target.value)}
                    required
                  />
                )}

                <button type="submit" disabled={inviting} className="btn-outline self-start text-xs">
                  {inviting ? 'Envoi…' : avecMotDePasse ? 'Créer et ajouter au pôle' : 'Envoyer l’invitation'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInviteOuvert(true);
                  setInfo(null);
                  setLienInvitation(null);
                }}
                disabled={!equipeId}
                className="flex w-fit items-center gap-1.5 text-xs font-semibold text-brand-foreground opacity-80 hover:opacity-100 disabled:opacity-40"
              >
                <UserPlus className="h-3.5 w-3.5" /> Inviter un membre
              </button>
            )}

            {lienInvitation && (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold">
                  Email non envoyé (SMTP non configuré) — transmettez ce lien vous-même, il reste valable 7 jours :
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-black/5 px-2 py-1 text-[11px] dark:bg-white/10">
                    {lienInvitation}
                  </code>
                  <button type="button" onClick={copierLien} className="btn-outline px-2 py-1 text-xs">
                    {lienCopie ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            {info && <p className="text-sm font-medium text-emerald-600">{info}</p>}

            <div className="flex justify-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
              <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
                Fermer
              </button>
              <button type="button" className="btn-primary" onClick={enregistrerMembres} disabled={saving || !equipeId}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
