'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { initiales, avatarClassName } from '@/lib/avatar';
import { apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import type { EquipeTache, MembreTache } from '@/lib/types';
import { EQUIPE_COULEUR_LABEL, labelClassName } from '@/lib/statuts';


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

  async function creerPole(e?: React.FormEvent) {
    e?.preventDefault();
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

  async function modifierPole(e?: React.FormEvent) {
    e?.preventDefault();
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
    mode === 'creation'
      ? 'Nouveau pôle'
      : mode === 'edition'
        ? `Modifier ${equipe?.nom ?? 'le pôle'}`
        : (equipe?.nom ?? 'Aucun pôle');
  const membresDuPole = personnesAffichees.filter((p) => selection.has(p.id));

  return (
    <div className="kdc-board kdc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="kdc-modal kdc-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="kdc-modal__head">
          <span className="kdc-modal__key">ÉQUIPES</span>
          <button type="button" onClick={onClose} className="kdc-modal__close" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="kdc-modal__title">{titre}</p>
        <p className="kdc-modal__meta">
          {mode === 'membres' && equipe ? (
            <>
              <span className={`kdc-label ${labelClassName(EQUIPE_COULEUR_LABEL[equipe.couleur] ?? 'docs')}`}>
                Code {equipe.code}
              </span>
              <span>·</span>
              <span>
                {selection.size} membre{selection.size > 1 ? 's' : ''} sur {personnesAffichees.length} compte
                {personnesAffichees.length > 1 ? 's' : ''} back-office
              </span>
            </>
          ) : mode === 'suppression' ? (
            <span>Suppression du pôle — les comptes des membres sont conservés.</span>
          ) : (
            <span>Nom, code court et couleur du chip d&apos;équipe.</span>
          )}
        </p>

        <div className="kdc-modal__grid">
          <div className="kdc-modal__col">
            {mode === 'creation' || mode === 'edition' ? (
              <>
                <div className="kdc-field-label">NOM DU PÔLE</div>
                <input
                  className="kdc-input kdc-input--full"
                  autoFocus
                  placeholder="Développement"
                  value={poleForm.nom}
                  onChange={(e) => setPoleForm({ ...poleForm, nom: e.target.value })}
                  required
                />

                <div className="kdc-field-label">CODE</div>
                <input
                  className="kdc-input kdc-input--full"
                  placeholder={mode === 'creation' ? 'déduit du nom si laissé vide' : ''}
                  value={poleForm.code}
                  onChange={(e) => setPoleForm({ ...poleForm, code: e.target.value })}
                  required={mode === 'edition'}
                />
                <p className="kdc-hint">Identifiant court et unique (minuscules, sans espaces).</p>

                <div className="kdc-field-label">COULEUR</div>
                {/* Le rendu réel du chip d'équipe, pas une pastille abstraite :
                    la charte étant monochrome, des ronds de couleur seraient
                    indistinguables les uns des autres. */}
                <div className="kdc-couleurs">
                  {COULEURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPoleForm({ ...poleForm, couleur: c })}
                      aria-label={`Couleur ${c}`}
                      aria-pressed={poleForm.couleur === c}
                      className={`kdc-label ${labelClassName(EQUIPE_COULEUR_LABEL[c])}`}
                    >
                      {poleForm.nom.trim() || 'Aperçu'}
                    </button>
                  ))}
                </div>
              </>
            ) : mode === 'suppression' ? (
              <>
                <div className="kdc-field-label">CONFIRMATION</div>
                <p className="kdc-hint">
                  Supprimer le pôle « {equipe?.nom} » ? Les comptes de ses membres sont conservés ; seul leur
                  rattachement à ce pôle disparaît.
                </p>

                <div className="kdc-field-label">TRANSFÉRER SES TÂCHES VERS</div>
                <select
                  className="kdc-select--full"
                  value={transfertVers}
                  onChange={(e) => setTransfertVers(e.target.value)}
                >
                  <option value="">Aucun (échoue si le pôle porte des tâches)</option>
                  {autresPoles.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.nom}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <div className="kdc-field-label kdc-field-label--icon">
                  <Users className="h-3.5 w-3.5" aria-hidden /> MEMBRES DU PÔLE
                  <span className="kdc-field-count">({selection.size})</span>
                </div>
                <div className="kdc-memberlist">
                  {personnesAffichees.map((p) => (
                    <div key={p.id} className="kdc-check__item">
                      <input
                        id={`membre-${p.id}`}
                        type="checkbox"
                        checked={selection.has(p.id)}
                        onChange={() => toggle(p.id)}
                        disabled={!equipeId}
                      />
                      <span className={`kdc-avatar ${avatarClassName(p.nomComplet)}`}>{initiales(p.nomComplet)}</span>
                      <label htmlFor={`membre-${p.id}`} className="min-w-0 flex-1 cursor-pointer truncate">
                        {p.nomComplet}
                      </label>
                      <span className="kdc-member__role">{ROLE_LABELS_EQUIPE[p.role] ?? p.role}</span>
                    </div>
                  ))}
                  {personnesAffichees.length === 0 && (
                    <p className="kdc-hint">Aucun compte back-office pour le moment.</p>
                  )}
                </div>

                <div className="kdc-field-label kdc-field-label--icon">
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> INVITER UN MEMBRE
                </div>
                {inviteOuvert ? (
                  <form onSubmit={inviter} className="kdc-invite">
                    <div className="kdc-invite__head">
                      <span className="kdc-hint" style={{ margin: 0 }}>
                        Le compte sera créé puis rattaché à ce pôle.
                      </span>
                      <button
                        type="button"
                        onClick={() => setInviteOuvert(false)}
                        className="kdc-check__x"
                        aria-label="Fermer le formulaire d'invitation"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <input
                      className="kdc-input kdc-input--full"
                      style={{ marginTop: 0 }}
                      placeholder="Nom complet"
                      value={inviteForm.nomComplet}
                      onChange={(e) => setInviteForm({ ...inviteForm, nomComplet: e.target.value })}
                      required
                    />
                    <input
                      className="kdc-input kdc-input--full"
                      style={{ marginTop: 0 }}
                      type="email"
                      placeholder="Email"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                      required
                    />
                    <select
                      className="kdc-select--full"
                      style={{ marginTop: 0 }}
                      value={inviteForm.role}
                      onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                    >
                      {ROLES_INVITATION.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS_EQUIPE[r]}
                        </option>
                      ))}
                    </select>

                    <label className="kdc-invite__check">
                      <input
                        type="checkbox"
                        checked={avecMotDePasse}
                        onChange={(e) => setAvecMotDePasse(e.target.checked)}
                      />
                      Définir moi-même le mot de passe (sinon : lien d&apos;activation par email)
                    </label>
                    {avecMotDePasse && (
                      <input
                        className="kdc-input kdc-input--full"
                        style={{ marginTop: 0 }}
                        type="password"
                        placeholder="Mot de passe (8+ car., maj/chiffre/spécial)"
                        minLength={8}
                        value={inviteSecret}
                        onChange={(e) => setInviteSecret(e.target.value)}
                        required
                      />
                    )}

                    <button type="submit" disabled={inviting} className="kdc-btn-outline self-start">
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
                    className="kdc-side__add"
                  >
                    + Inviter un membre
                  </button>
                )}

                {lienInvitation && (
                  <div className="kdc-linkbox">
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                      Email non envoyé (SMTP non configuré) — transmettez ce lien vous-même, il reste valable 7 jours :
                    </p>
                    <div className="kdc-linkbox__row">
                      <code>{lienInvitation}</code>
                      <button type="button" onClick={copierLien} className="kdc-check__add">
                        {lienCopie ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
            {info && <p className="kdc-ok">{info}</p>}
          </div>

          <div className="kdc-modal__col kdc-modal__col--side">
            <div className="kdc-field-label">PÔLE</div>
            <select
              className="kdc-select--full"
              value={equipeId}
              onChange={(e) => selectionnerEquipe(e.target.value)}
              disabled={equipes.length === 0 || mode !== 'membres'}
              aria-label="Pôle"
            >
              {equipes.length === 0 && <option value="">Aucun pôle</option>}
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.nom}
                </option>
              ))}
            </select>

            {peutGererPoles && mode === 'membres' && (
              <>
                <div className="kdc-field-label">CYCLE DE VIE DU PÔLE</div>
                <div className="kdc-side__actions">
                  <button type="button" className="kdc-side__action" onClick={ouvrirCreation}>
                    <Plus className="h-3.5 w-3.5" /> Créer un pôle
                  </button>
                  <button type="button" className="kdc-side__action" onClick={ouvrirEdition} disabled={!equipeId}>
                    <Pencil className="h-3.5 w-3.5" /> Renommer / recolorer
                  </button>
                  <button
                    type="button"
                    className="kdc-side__action kdc-side__action--danger"
                    onClick={ouvrirSuppression}
                    disabled={!equipeId}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer le pôle
                  </button>
                </div>
              </>
            )}

            {mode === 'membres' && (
              <>
                <div className="kdc-field-label">EFFECTIF RETENU</div>
                {membresDuPole.length > 0 ? (
                  <div className="kdc-options">
                    {membresDuPole.slice(0, 8).map((p) => (
                      <span key={p.id} className={`kdc-avatar ${avatarClassName(p.nomComplet)}`} title={p.nomComplet}>
                        {initiales(p.nomComplet)}
                      </span>
                    ))}
                    {membresDuPole.length > 8 && (
                      <span className="kdc-avatar kdc-avatar--more">+{membresDuPole.length - 8}</span>
                    )}
                  </div>
                ) : (
                  <p className="kdc-side__empty">Aucun membre coché</p>
                )}
              </>
            )}

            <hr className="kdc-side__hr" />
            <div className="kdc-side__foot">
              {mode === 'membres' ? (
                <>
                  <button
                    type="button"
                    className="kdc-btn-primary"
                    onClick={enregistrerMembres}
                    disabled={saving || !equipeId}
                  >
                    {saving ? 'Enregistrement…' : 'Enregistrer la composition'}
                  </button>
                  <button type="button" className="kdc-side__cancel" onClick={onClose} disabled={saving}>
                    Fermer
                  </button>
                </>
              ) : mode === 'suppression' ? (
                <>
                  <button type="button" className="kdc-side__action kdc-side__action--danger" onClick={supprimerPole} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {saving ? 'Suppression…' : 'Supprimer définitivement'}
                  </button>
                  <button type="button" className="kdc-side__cancel" onClick={reinitialiserEtat} disabled={saving}>
                    Annuler
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="kdc-btn-primary"
                    onClick={() => (mode === 'creation' ? creerPole() : modifierPole())}
                    disabled={saving || !poleForm.nom.trim() || (mode === 'edition' && !poleForm.code.trim())}
                  >
                    {saving ? 'Enregistrement…' : mode === 'creation' ? 'Créer le pôle' : 'Enregistrer'}
                  </button>
                  <button type="button" className="kdc-side__cancel" onClick={reinitialiserEtat} disabled={saving}>
                    Annuler
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
