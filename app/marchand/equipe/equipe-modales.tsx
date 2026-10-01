'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Mail, ShieldAlert, Sparkles, UserPlus, Wand2 } from 'lucide-react';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import { apiDelete, apiPatch, apiPost } from '@/lib/api-client';
import {
  PERMISSIONS_MARCHAND,
  completerDependances,
  definitionPermissionMarchand,
  dependantsDe,
  libellePermissionMarchand,
  nettoyerPermissionsMarchand,
} from '@/lib/permissions-marchand';
import type { DonneesEquipe, MembreEquipe, RoleEquipe } from './equipe-types';
import { rolesAttribuables } from './equipe-ui';

function messageErreur(err: unknown): string {
  return err instanceof Error ? err.message : 'Erreur';
}

// Mot de passe conforme à la politique (8+, majuscule, chiffre, spécial),
// proposé en un clic pour l'ajout manuel.
function genererMotDePasse(): string {
  const maj = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const min = 'abcdefghijkmnpqrstuvwxyz';
  const chif = '23456789';
  const spec = '!@#$%&*?';
  const tout = maj + min + chif + spec;
  const alea = (n: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const pick = (s: string) => s[alea(s.length)];
  const car = [pick(maj), pick(min), pick(chif), pick(spec)];
  while (car.length < 12) car.push(pick(tout));
  for (let i = car.length - 1; i > 0; i -= 1) {
    const j = alea(i + 1);
    [car[i], car[j]] = [car[j], car[i]];
  }
  return car.join('');
}

function ChampMotDePasse({
  valeur,
  onChange,
  label = 'Mot de passe',
  generer,
}: {
  valeur: string;
  onChange: (v: string) => void;
  label?: string;
  generer?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} required hint="8 caractères minimum, avec majuscule, chiffre et caractère spécial.">
      <span className="flex gap-2">
        <span className="relative flex min-w-0 flex-1">
          <input
            className="input-basic w-full pr-10"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            minLength={8}
            required
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white"
            aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
        {generer && (
          <button
            type="button"
            className="btn-outline px-3"
            onClick={() => {
              onChange(genererMotDePasse());
              setVisible(true);
            }}
            title="Générer un mot de passe robuste"
          >
            <Wand2 className="h-4 w-4" />
            <span className="hidden sm:inline">Générer</span>
          </button>
        )}
      </span>
    </Field>
  );
}

// Choix d'un rôle, avec le résumé de ce qu'il ouvre juste en dessous : on
// n'attribue pas un rôle sur son seul nom.
function ChoixRole({
  roles,
  valeur,
  onChange,
}: {
  roles: RoleEquipe[];
  valeur: string;
  onChange: (id: string) => void;
}) {
  const role = roles.find((r) => r.id === valeur);
  return (
    <Field label="Rôle" required>
      <select className="input-basic" value={valeur} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          Choisir un rôle…
        </option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nom}
            {r.systeme ? '' : ' (personnalisé)'}
          </option>
        ))}
      </select>
      {role && (
        <span className="mt-1 block rounded-xl bg-black/[0.03] px-3 py-2 text-xs text-black/60 dark:bg-white/[0.04] dark:text-white/60">
          {role.description && <span className="mb-1 block">{role.description}</span>}
          <span className="flex flex-wrap gap-1">
            {role.permissions.map((p) => (
              <span
                key={p}
                className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black/70 shadow-sm dark:bg-white/10 dark:text-white/75"
              >
                {libellePermissionMarchand(p)}
              </span>
            ))}
          </span>
        </span>
      )}
    </Field>
  );
}

function ChampExpiration({
  actif,
  onActif,
  valeur,
  onChange,
}: {
  actif: boolean;
  onActif: (v: boolean) => void;
  valeur: string;
  onChange: (v: string) => void;
}) {
  // Figé au montage : borne basse du sélecteur de date (demain).
  const [demain] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="check-basic" checked={actif} onChange={(e) => onActif(e.target.checked)} />
        Accès temporaire
        <span className="text-xs font-normal text-black/50 dark:text-white/50">— stagiaire, renfort de saison…</span>
      </label>
      {actif && (
        <Field label="Accès valable jusqu’au" required hint="Passé ce jour, la connexion est refusée automatiquement.">
          <input
            className="input-basic"
            type="date"
            min={demain}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </Field>
      )}
    </div>
  );
}

// Lien d'activation à transmettre soi-même quand l'email n'a pas pu partir.
export function LienActivation({ lien }: { lien: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[color:var(--mk-amber-line)] bg-[color:var(--mk-amber-soft)] p-3 text-[color:var(--mk-amber-ink)]">
      <p className="text-[13px] font-semibold">
        L’email n’a pas pu être envoyé. Transmettez ce lien à la personne (valable 7 jours) :
      </p>
      <div className="flex gap-2">
        <input readOnly className="input-basic min-w-0 flex-1 font-mono text-xs" value={lien} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn-outline px-3"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(lien);
              setCopie(true);
              setTimeout(() => setCopie(false), 2000);
            } catch {
              /* le champ reste sélectionnable à la main */
            }
          }}
        >
          {copie ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="hidden sm:inline">{copie ? 'Copié' : 'Copier'}</span>
        </button>
      </div>
    </div>
  );
}

// --- Ajouter / inviter -----------------------------------------------------

export function AjouterMembreModal({
  donnees,
  onClose,
  onFait,
}: {
  donnees: DonneesEquipe;
  onClose: () => void;
  onFait: () => void;
}) {
  const roles = rolesAttribuables(donnees);
  const roleParDefaut = roles.find((r) => r.cle === 'operateur') ?? roles[0];
  const [mode, setMode] = useState<'invitation' | 'manuel'>('invitation');
  const [form, setForm] = useState({
    nomComplet: '',
    email: '',
    poste: '',
    roleId: roleParDefaut?.id ?? '',
    secret: '',
  });
  const [temporaire, setTemporaire] = useState(false);
  const [expiration, setExpiration] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<{ emailEnvoye?: boolean; lienActivation?: string; nom: string } | null>(
    null
  );

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      const res = await apiPost<{ emailEnvoye?: boolean; lienActivation?: string }>('/api/marchands/equipe/membres', {
        mode,
        nomComplet: form.nomComplet,
        email: form.email,
        poste: form.poste,
        roleId: form.roleId,
        secret: mode === 'manuel' ? form.secret : undefined,
        accesExpireLe: temporaire ? expiration : null,
      });
      onFait();
      setResultat({ ...res, nom: form.nomComplet });
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  if (resultat) {
    return (
      <Modal title="Membre ajouté" onClose={onClose} size="md">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Check className="h-5 w-5" />
            </span>
            <div className="text-sm">
              {mode === 'manuel' ? (
                <p>
                  <strong>{resultat.nom}</strong> peut se connecter dès maintenant avec son email et le mot de passe que
                  vous avez choisi. Communiquez-le-lui par un canal sûr.
                </p>
              ) : resultat.emailEnvoye ? (
                <p>
                  Invitation envoyée à <strong>{form.email}</strong>. {resultat.nom} choisira son mot de passe via le lien
                  reçu, valable 7 jours.
                </p>
              ) : (
                <p>
                  Le compte de <strong>{resultat.nom}</strong> est créé, en attente d’activation.
                </p>
              )}
            </div>
          </div>
          {resultat.lienActivation && <LienActivation lien={resultat.lienActivation} />}
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Terminé
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Ajouter un membre" onClose={onClose} size="lg">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        {/* Deux façons d'entrer dans l'équipe : l'invitation (la personne
            choisit elle-même son mot de passe) est le mode recommandé. */}
        <div role="radiogroup" aria-label="Mode d’ajout" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['invitation', Mail, 'Inviter par email', 'La personne reçoit un lien et choisit son mot de passe.'],
              ['manuel', UserPlus, 'Créer le compte', 'Vous fixez le mot de passe et le lui transmettez.'],
            ] as const
          ).map(([cle, Icone, titre, texte]) => {
            const actif = mode === cle;
            return (
              <button
                key={cle}
                type="button"
                role="radio"
                aria-checked={actif}
                onClick={() => setMode(cle)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                  actif
                    ? 'border-brand bg-brand/[0.12] ring-[3px] ring-brand/20'
                    : 'border-black/10 hover:border-black/25 dark:border-white/15 dark:hover:border-white/30'
                }`}
              >
                <Icone className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="flex items-center gap-2 text-sm font-bold">
                    {titre}
                    {cle === 'invitation' && <span className="badge badge-brand px-1.5 py-0.5 text-[9px]">Recommandé</span>}
                  </span>
                  <span className="block text-xs text-black/55 dark:text-white/55">{texte}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="form-grid">
          <Field label="Nom complet" required>
            <input
              className="input-basic"
              placeholder="Ex. Salma Bennani"
              value={form.nomComplet}
              onChange={(e) => setForm({ ...form, nomComplet: e.target.value })}
              maxLength={120}
              required
              autoFocus
            />
          </Field>
          <Field label="Email" required hint="Identifiant de connexion du membre.">
            <input
              className="input-basic"
              type="email"
              placeholder="collaborateur@exemple.ma"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </Field>
          <Field label="Poste" optional>
            <input
              className="input-basic"
              placeholder="Ex. Responsable logistique"
              value={form.poste}
              onChange={(e) => setForm({ ...form, poste: e.target.value })}
              maxLength={80}
            />
          </Field>
          <ChoixRole roles={roles} valeur={form.roleId} onChange={(roleId) => setForm({ ...form, roleId })} />
          {mode === 'manuel' && (
            <div className="sm:col-span-2">
              <ChampMotDePasse valeur={form.secret} onChange={(secret) => setForm({ ...form, secret })} generer />
            </div>
          )}
          <ChampExpiration actif={temporaire} onActif={setTemporaire} valeur={expiration} onChange={setExpiration} />
        </div>

        {erreur && <p className="form-error">{erreur}</p>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi}>
            {mode === 'invitation' ? <Mail className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {envoi ? 'Envoi…' : mode === 'invitation' ? 'Envoyer l’invitation' : 'Créer le compte'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Modifier ---------------------------------------------------------------

export function ModifierMembreModal({
  donnees,
  membre,
  onClose,
  onFait,
}: {
  donnees: DonneesEquipe;
  membre: MembreEquipe;
  onClose: () => void;
  onFait: () => void;
}) {
  const attribuables = rolesAttribuables(donnees);
  // Le rôle actuel reste dans la liste même s'il n'est pas attribuable par
  // l'auteur (il ne l'est alors pas non plus « désattribuable » — le serveur
  // tranchera ; mais le select ne doit pas afficher un rôle vide).
  const roles = attribuables.some((r) => r.id === membre.roleId)
    ? attribuables
    : [...donnees.roles.filter((r) => r.id === membre.roleId), ...attribuables];
  const [form, setForm] = useState({
    nomComplet: membre.nomComplet,
    poste: membre.poste ?? '',
    roleId: membre.roleId,
  });
  const [temporaire, setTemporaire] = useState(!!membre.accesExpireLe);
  const [expiration, setExpiration] = useState(membre.accesExpireLe ? membre.accesExpireLe.slice(0, 10) : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      const body: Record<string, unknown> = { nomComplet: form.nomComplet, poste: form.poste };
      if (form.roleId !== membre.roleId) body.roleId = form.roleId;
      const expAvant = membre.accesExpireLe ? membre.accesExpireLe.slice(0, 10) : '';
      const expApres = temporaire ? expiration : '';
      if (expAvant !== expApres) body.accesExpireLe = expApres || null;
      await apiPatch(`/api/marchands/equipe/membres/${membre.id}`, body);
      onFait();
      onClose();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal title={`Modifier — ${membre.nomComplet}`} onClose={onClose} size="lg">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <div className="form-grid">
          <Field label="Nom complet" required>
            <input
              className="input-basic"
              value={form.nomComplet}
              onChange={(e) => setForm({ ...form, nomComplet: e.target.value })}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Email" hint="L’identifiant de connexion ne se modifie pas.">
            <input className="input-basic" value={membre.email ?? ''} disabled />
          </Field>
          <Field label="Poste" optional>
            <input
              className="input-basic"
              value={form.poste}
              onChange={(e) => setForm({ ...form, poste: e.target.value })}
              maxLength={80}
            />
          </Field>
          <ChoixRole roles={roles} valeur={form.roleId} onChange={(roleId) => setForm({ ...form, roleId })} />
          <ChampExpiration actif={temporaire} onActif={setTemporaire} valeur={expiration} onChange={setExpiration} />
        </div>
        {erreur && <p className="form-error">{erreur}</p>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Mot de passe -----------------------------------------------------------

export function MotDePasseModal({
  membre,
  onClose,
  onFait,
}: {
  membre: MembreEquipe;
  onClose: () => void;
  onFait: () => void;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (motDePasse !== confirmation) {
      setErreur('Les mots de passe ne correspondent pas');
      return;
    }
    setEnvoi(true);
    try {
      await apiPost(`/api/marchands/equipe/membres/${membre.id}/mot-de-passe`, {
        motDePasse,
        confirmationMotDePasse: confirmation,
      });
      onFait();
      setFait(true);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal title={`Mot de passe — ${membre.nomComplet}`} onClose={onClose} size="sm">
      {fait ? (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Mot de passe mis à jour. Transmettez-le à <strong>{membre.nomComplet}</strong> par un canal sûr : il se
            connectera avec <strong>{membre.email}</strong>.
          </p>
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Terminé
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={soumettre} className="flex flex-col gap-3">
          <ChampMotDePasse
            label="Nouveau mot de passe"
            valeur={motDePasse}
            onChange={(v) => {
              setMotDePasse(v);
              setConfirmation('');
            }}
            generer
          />
          <Field label="Confirmation" required>
            <input
              className="input-basic"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
            />
          </Field>
          {erreur && <p className="form-error">{erreur}</p>}
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Valider'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// --- Confirmation générique -------------------------------------------------

export function ConfirmationModal({
  titre,
  children,
  libelle,
  danger,
  onConfirmer,
  onClose,
}: {
  titre: string;
  children: React.ReactNode;
  libelle: string;
  danger?: boolean;
  onConfirmer: () => Promise<void>;
  onClose: () => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <Modal title={titre} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <div className="text-sm text-black/75 dark:text-white/75">{children}</div>
        {erreur && <p className="form-error">{erreur}</p>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger-solid' : 'btn-primary'}
            disabled={envoi}
            onClick={async () => {
              setErreur(null);
              setEnvoi(true);
              try {
                await onConfirmer();
                onClose();
              } catch (err) {
                setErreur(messageErreur(err));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {envoi ? 'Patientez…' : libelle}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- Grille de permissions --------------------------------------------------
//
// Cocher une case coche aussi ce qu'elle présuppose ; décocher une case
// décoche ce qui en dépend — la grille affiche donc toujours exactement ce que
// le serveur enregistrera (nettoyerPermissionsMarchand). Les droits que
// l'auteur ne détient pas sont grisés : il ne peut pas les accorder.

export function GrillePermissions({
  valeur,
  onChange,
  lectureSeule,
  accordables,
}: {
  valeur: string[];
  onChange?: (v: string[]) => void;
  lectureSeule?: boolean;
  accordables?: string[];
}) {
  const set = new Set(valeur);
  const peutAccorder = (k: string) => !accordables || accordables.includes(k);

  function basculer(key: string) {
    if (!onChange) return;
    if (set.has(key)) {
      const retirer = new Set([key, ...dependantsDe(key)]);
      onChange(nettoyerPermissionsMarchand(valeur.filter((k) => !retirer.has(k))));
    } else {
      onChange(nettoyerPermissionsMarchand([...completerDependances([...valeur, key])]));
    }
  }

  function basculerCategorie(keys: string[], toutCoche: boolean) {
    if (!onChange) return;
    if (toutCoche) {
      const retirer = new Set(keys.flatMap((k) => [k, ...dependantsDe(k)]));
      onChange(nettoyerPermissionsMarchand(valeur.filter((k) => !retirer.has(k))));
    } else {
      onChange(nettoyerPermissionsMarchand([...valeur, ...keys.filter(peutAccorder)]));
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PERMISSIONS_MARCHAND.map((cat) => {
        const keys = cat.permissions.map((p) => p.key);
        const nbCoches = keys.filter((k) => set.has(k)).length;
        const toutCoche = nbCoches === keys.length;
        return (
          <fieldset
            key={cat.categorie}
            className="flex flex-col rounded-xl border border-black/[0.08] bg-black/[0.015] dark:border-white/10 dark:bg-white/[0.02]"
          >
            <legend className="sr-only">{cat.categorie}</legend>
            <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/10">
              <span className="text-[11px] font-bold uppercase tracking-wider text-black/60 dark:text-white/60">
                {cat.categorie}
                <span className="ml-1.5 font-semibold normal-case tracking-normal text-black/40 dark:text-white/40">
                  {nbCoches}/{keys.length}
                </span>
              </span>
              {!lectureSeule && (
                <button
                  type="button"
                  className="text-[11px] font-bold text-black/50 underline-offset-2 hover:text-black hover:underline pointer-coarse:py-2 dark:text-white/50 dark:hover:text-white"
                  onClick={() => basculerCategorie(keys, toutCoche)}
                >
                  {toutCoche ? 'Tout retirer' : 'Tout cocher'}
                </button>
              )}
            </div>
            <ul className="flex flex-col p-1">
              {cat.permissions.map((p) => {
                const coche = set.has(p.key);
                const bloque = lectureSeule || (!coche && !peutAccorder(p.key));
                const requis = (p.requiert ?? []).map(libellePermissionMarchand);
                return (
                  <li key={p.key}>
                    <label
                      className={`flex items-start gap-3 rounded-lg px-2 py-2 ${
                        bloque ? 'cursor-default' : 'cursor-pointer hover:bg-brand/[0.08]'
                      } ${!coche && bloque && !lectureSeule ? 'opacity-45' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="check-basic mt-0.5"
                        checked={coche}
                        disabled={bloque}
                        onChange={() => basculer(p.key)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                          {p.label}
                          {p.sensible && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400"
                              title="Donne accès à des données financières ou engage la boutique"
                            >
                              <ShieldAlert className="h-2.5 w-2.5" /> Sensible
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-black/50 dark:text-white/50">{p.description}</span>
                        {requis.length > 0 && !lectureSeule && (
                          <span className="block text-[11px] text-black/40 dark:text-white/40">
                            Inclut : {requis.join(', ')}
                          </span>
                        )}
                        {!coche && !peutAccorder(p.key) && !lectureSeule && (
                          <span className="block text-[11px] text-black/45 dark:text-white/45">
                            Vous ne détenez pas ce droit.
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

// --- Éditeur de rôle --------------------------------------------------------

export type ModeEditeurRole =
  | { kind: 'creer' }
  | { kind: 'dupliquer'; source: RoleEquipe }
  | { kind: 'modifier'; role: RoleEquipe }
  | { kind: 'voir'; role: RoleEquipe };

export function EditeurRoleModal({
  mode,
  donnees,
  onClose,
  onFait,
}: {
  mode: ModeEditeurRole;
  donnees: DonneesEquipe;
  onClose: () => void;
  onFait: () => void;
}) {
  const initial = useMemo(() => {
    if (mode.kind === 'creer') return { nom: '', description: '', permissions: ['colis.voir'] };
    if (mode.kind === 'dupliquer') {
      return {
        nom: `${mode.source.nom} (copie)`,
        description: mode.source.description ?? '',
        permissions: mode.source.permissions,
      };
    }
    return { nom: mode.role.nom, description: mode.role.description ?? '', permissions: mode.role.permissions };
  }, [mode]);
  const [form, setForm] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const lectureSeule = mode.kind === 'voir';
  const accordables = donnees.moi.estTitulaire ? undefined : donnees.moi.permissions;

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
        await apiPatch(`/api/marchands/equipe/roles/${mode.role.id}`, form);
      } else {
        await apiPost('/api/marchands/equipe/roles', form);
      }
      onFait();
      onClose();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  }

  const nbSensibles = form.permissions.filter((k) => definitionPermissionMarchand(k)?.sensible).length;

  return (
    <Modal title={titre} onClose={onClose} size="lg">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        {mode.kind === 'voir' && (
          <p className="flex items-start gap-2 rounded-xl bg-brand/[0.12] px-3 py-2 text-[13px]">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            Rôle prédéfini : ses droits suivent l’évolution de la plateforme et ne se modifient pas. Dupliquez-le pour
            l’adapter.
          </p>
        )}
        {!lectureSeule && (
          <div className="form-grid">
            <Field label="Nom du rôle" required>
              <input
                className="input-basic"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                maxLength={60}
                placeholder="Ex. Service client"
                required
                autoFocus
              />
            </Field>
            <Field label="Description" optional>
              <input
                className="input-basic"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={240}
                placeholder="À quoi sert ce rôle ?"
              />
            </Field>
          </div>
        )}
        {lectureSeule && form.description && <p className="text-sm text-black/60 dark:text-white/60">{form.description}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="form-subtitle">Permissions</span>
          <span className="text-xs text-black/50 dark:text-white/50">
            {form.permissions.length} droit{form.permissions.length > 1 ? 's' : ''}
            {nbSensibles > 0 && ` · dont ${nbSensibles} sensible${nbSensibles > 1 ? 's' : ''}`}
          </span>
        </div>
        <GrillePermissions
          valeur={form.permissions}
          onChange={(permissions) => setForm({ ...form, permissions })}
          lectureSeule={lectureSeule}
          accordables={accordables}
        />

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

// --- Suppression d'un rôle --------------------------------------------------

export function SupprimerRoleModal({
  role,
  donnees,
  onClose,
  onFait,
}: {
  role: RoleEquipe;
  donnees: DonneesEquipe;
  onClose: () => void;
  onFait: () => void;
}) {
  const remplacants = rolesAttribuables(donnees).filter((r) => r.id !== role.id);
  const [cible, setCible] = useState(remplacants.find((r) => r.cle === 'lecture')?.id ?? remplacants[0]?.id ?? '');
  return (
    <ConfirmationModal
      titre={`Supprimer le rôle « ${role.nom} »`}
      libelle="Supprimer le rôle"
      danger
      onClose={onClose}
      onConfirmer={async () => {
        const qs = role.nbMembres > 0 ? `?reaffecterVers=${encodeURIComponent(cible)}` : '';
        await apiDelete(`/api/marchands/equipe/roles/${role.id}${qs}`);
        onFait();
      }}
    >
      {role.nbMembres > 0 ? (
        <div className="flex flex-col gap-3">
          <p>
            Ce rôle est attribué à{' '}
            <strong>
              {role.nbMembres} membre{role.nbMembres > 1 ? 's' : ''}
            </strong>
            . Choisissez le rôle qui le remplacera pour eux :
          </p>
          <select className="input-basic w-full" value={cible} onChange={(e) => setCible(e.target.value)}>
            {remplacants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p>Ce rôle n’est attribué à personne. Sa suppression est définitive.</p>
      )}
    </ConfirmationModal>
  );
}
