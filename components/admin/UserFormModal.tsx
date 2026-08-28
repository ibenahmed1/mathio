'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Upload, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { readFileAsDataUrl } from '@/lib/read-file';
import { VILLES_RAMASSAGE, BANQUES_MAROC } from '@/lib/marchand-form-options';
import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from '@/lib/permissions';
import type { Hub, Utilisateur } from '@/lib/types';
import type { Role } from '@/app/generated/prisma/enums';
import { Modal } from '@/components/admin/Modal';
import { Affix, Field } from '@/components/form/Field';

export type UserFormMode = { kind: 'create' } | { kind: 'edit'; utilisateur: Utilisateur };

const ROLES = [
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'ramasseur',
  'livreur',
  'design',
  'gestionnaire_hub',
  'agent_hub',
  'planner',
] as const;

export const ROLE_LABELS: Record<string, string> = {
  superviseur: 'Superviseur',
  moderateur: 'Modérateur',
  equipe_suivi: 'Équipe de suivi',
  responsable: 'Responsable',
  ramasseur: 'Ramasseur',
  livreur: 'Livreur',
  design: 'Design (Kanban uniquement)',
  gestionnaire_hub: 'Gestionnaire Hub (Kanban uniquement)',
  agent_hub: 'Agent Hub (Réception dépôt uniquement)',
  planner: 'Planner (Tournées de son hub uniquement)',
};

const ROLES_TERRAIN = ['ramasseur', 'livreur'];
const ROLES_AVEC_PHOTO = ['ramasseur', 'livreur', 'moderateur'];
const ROLES_AVEC_HUB = ['agent_hub', 'livreur', 'planner'];

// Même règle que côté serveur (PATCH /api/utilisateurs/[id]) : un rôle
// supplémentaire ne peut être accordé qu'au sein du même espace applicatif
// (back-office vs terrain) que le rôle réel de l'utilisateur — jamais admin
// ni marchand, non gérés par cette API.
function espaceDe(r: string): 'admin' | 'terrain' {
  return ROLES_TERRAIN.includes(r) ? 'terrain' : 'admin';
}

type PieceKey = 'cinRectoUrl' | 'cinVersoUrl' | 'ribPhotoUrl';
const PIECES: { key: PieceKey; label: string }[] = [
  { key: 'cinRectoUrl', label: 'CIN Recto' },
  { key: 'cinVersoUrl', label: 'CIN Verso' },
  { key: 'ribPhotoUrl', label: 'RIB' },
];

// Brouillon local : tout ce qui est saisi survit à une fermeture accidentelle,
// une navigation ailleurs dans l'app ou un plantage du navigateur (rechargé
// depuis localStorage à la réouverture) — jamais le mot de passe. Si les
// photos font dépasser le quota localStorage, on retombe sur un brouillon
// texte seul plutôt que de tout perdre.
type Draft = Record<string, string | null>;

function draftKeyFor(mode: UserFormMode) {
  return mode.kind === 'create' ? 'equipe-user-draft:create' : `equipe-user-draft:edit:${mode.utilisateur.id}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    // Quota dépassé (probablement à cause des photos en base64) : on retente
    // texte seul plutôt que de perdre tout le brouillon.
    const { photoUrl, cinRectoUrl, cinVersoUrl, ribPhotoUrl, ...texte } = draft;
    try {
      localStorage.setItem(key, JSON.stringify(texte));
    } catch {
      // localStorage indisponible (navigation privée…) : pas de brouillon, tant pis.
    }
    return false;
  }
}

function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // rien à faire
  }
}

// Formulaire unique pour créer OU modifier un compte équipe, quelle que soit
// la fonction : les champs terrain (CIN, zones, banque, frais, pièces
// jointes) et la photo de profil apparaissent/disparaissent en direct selon
// la fonction sélectionnée, plutôt que d'avoir un formulaire dédié par rôle.
export function UserFormModal({
  mode,
  onClose,
  onSaved,
}: {
  mode: UserFormMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existant = mode.kind === 'edit' ? mode.utilisateur : null;
  const [draftKey] = useState(() => draftKeyFor(mode));
  const [draft] = useState(() => readDraft(draftKey));
  const [draftRestaure, setDraftRestaure] = useState(!!draft);
  const [photosNonSauvegardees, setPhotosNonSauvegardees] = useState(false);

  const [role, setRole] = useState(draft?.role ?? existant?.role ?? 'superviseur');
  const [rolesSupplementaires, setRolesSupplementaires] = useState<string[]>(existant?.rolesSupplementaires ?? []);
  // Permissions du back-office (§ lib/permissions.ts). À la MODIFICATION, ce
  // que le compte détient réellement ; à la CRÉATION, le jeu par défaut de la
  // fonction choisie, que l'admin peut ajuster case par case avant d'envoyer.
  const [permissions, setPermissions] = useState<string[]>(
    mode.kind === 'edit'
      ? (existant?.permissions ?? [])
      : (ROLE_PERMISSIONS[(draft?.role ?? 'superviseur') as Role] ?? [])
  );
  const [hubId, setHubId] = useState(draft?.hubId ?? existant?.hubId ?? '');
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [photo, setPhoto] = useState<string | null>(draft?.photoUrl ?? existant?.photoUrl ?? null);
  const [cinRecto, setCinRecto] = useState<string | null>(draft?.cinRectoUrl ?? null);
  const [cinVerso, setCinVerso] = useState<string | null>(draft?.cinVersoUrl ?? null);
  const [rib, setRib] = useState<string | null>(draft?.ribPhotoUrl ?? null);
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showConfirmSecret, setShowConfirmSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const estTerrain = ROLES_TERRAIN.includes(role);
  const avecPhoto = ROLES_AVEC_PHOTO.includes(role);
  const avecHub = ROLES_AVEC_HUB.includes(role);
  const pieces: Record<PieceKey, [string | null, (v: string | null) => void]> = {
    cinRectoUrl: [cinRecto, setCinRecto],
    cinVersoUrl: [cinVerso, setCinVerso],
    ribPhotoUrl: [rib, setRib],
  };

  // Liste des hubs pour le select "Hub de rattachement" (agent_hub et
  // livreur) — chargée une seule fois, indépendamment du rôle sélectionné au
  // moment du montage (l'utilisateur peut changer de rôle en cours de route).
  useEffect(() => {
    apiGet<{ data: Hub[] }>('/api/hubs')
      .then((res) => setHubs(res.data))
      .catch(() => {});
  }, []);

  // Sauvegarde best-effort de tout ce qui est saisi (hors mot de passe),
  // pour survivre à une fermeture accidentelle / un plantage. `overrides`
  // permet de passer une valeur qui n'a pas encore fini d'être appliquée au
  // state React (ex. la photo juste convertie en base64).
  function saveDraftNow(overrides: Partial<Draft> = {}) {
    const texte: Draft = {};
    if (formRef.current) {
      const fd = new FormData(formRef.current);
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string' && k !== 'secret' && k !== 'confirmSecret') texte[k] = v;
      }
    }
    const complet: Draft = {
      ...texte,
      role: overrides.role ?? role,
      photoUrl: 'photoUrl' in overrides ? overrides.photoUrl : photo,
      cinRectoUrl: 'cinRectoUrl' in overrides ? overrides.cinRectoUrl : cinRecto,
      cinVersoUrl: 'cinVersoUrl' in overrides ? overrides.cinVersoUrl : cinVerso,
      ribPhotoUrl: 'ribPhotoUrl' in overrides ? overrides.ribPhotoUrl : rib,
    };
    const ok = writeDraft(draftKey, complet);
    setPhotosNonSauvegardees(!ok);
  }

  function handleFormChange() {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveDraftNow(), 400);
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : null;
      setPhoto(url);
      saveDraftNow({ photoUrl: url });
    };
    reader.readAsDataURL(file);
  }

  async function handlePieceChange(key: PieceKey, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFileAsDataUrl(file);
    pieces[key][1](url);
    saveDraftNow({ [key]: url });
  }

  function handleRoleChange(newRole: string) {
    setRole(newRole);
    saveDraftNow({ role: newRole });
    // Un octroi n'a de sens que dans le même espace applicatif que le rôle
    // (voir espaceDe ci-dessus) : si la fonction change d'espace (ex.
    // superviseur -> livreur), les rôles supplémentaires précédents ne
    // s'appliqueraient plus et seraient rejetés par l'API — on les retire ici
    // plutôt que de laisser l'utilisateur découvrir l'erreur à la soumission.
    setRolesSupplementaires((prev) => prev.filter((r) => r !== newRole && espaceDe(r) === espaceDe(newRole)));
    // À la CRÉATION, changer de fonction repositionne les cases sur le jeu par
    // défaut de la nouvelle fonction : l'admin part de ce que fait ce métier,
    // puis ajuste. À la MODIFICATION on n'y touche pas — les cases reflètent
    // ce que le compte détient réellement, et un changement de fonction ne
    // doit pas effacer silencieusement un accès accordé à la main.
    if (mode.kind === 'create') {
      setPermissions(ROLE_PERMISSIONS[newRole as Role] ?? []);
    }
  }

  function toggleRoleSupplementaire(r: string) {
    setRolesSupplementaires((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function togglePermission(key: string) {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }

  function toggleCategorie(cles: string[], toutCoche: boolean) {
    setPermissions((prev) =>
      toutCoche ? prev.filter((x) => !cles.includes(x)) : Array.from(new Set([...prev, ...cles]))
    );
  }

  function ignorerBrouillon() {
    clearDraft(draftKey);
    setDraftRestaure(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (mode.kind === 'create' && secret !== confirmSecret) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    const fd = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        nomComplet: String(fd.get('nomComplet') ?? ''),
        telephone: String(fd.get('telephone') ?? ''),
        email: String(fd.get('email') ?? ''),
        role,
      };
      if (avecPhoto) payload.photoUrl = photo ?? '';
      if (estTerrain) {
        payload.cin = String(fd.get('cin') ?? '');
        payload.zonePrincipale = String(fd.get('zonePrincipale') ?? '');
        payload.zoneSecondaire = String(fd.get('zoneSecondaire') ?? '');
        payload.adresse = String(fd.get('adresse') ?? '');
        payload.nomBanque = String(fd.get('nomBanque') ?? '');
        payload.numeroCompte = String(fd.get('numeroCompte') ?? '');
        payload.fraisLivraison = String(fd.get('fraisLivraison') ?? '');
        payload.fraisRefus = String(fd.get('fraisRefus') ?? '');
        payload.cinRectoUrl = cinRecto ?? '';
        payload.cinVersoUrl = cinVerso ?? '';
        payload.ribPhotoUrl = rib ?? '';
      }
      if (avecHub) {
        if (!hubId) {
          setError('Un hub de rattachement est requis pour cette fonction');
          setSaving(false);
          return;
        }
        payload.hubId = hubId;
      }
      // Toujours envoyé pour un compte back-office, y compris vide : c'est la
      // liste transmise qui remplace celle du compte, un décochage doit donc
      // pouvoir retirer le dernier accès. Pour un compte terrain, on n'envoie
      // rien — le catalogue ne les gouverne pas (§ lib/permissions.ts).
      if (!estTerrain) payload.permissions = permissions;

      if (mode.kind === 'create') {
        payload.secret = secret;
        payload.confirmSecret = confirmSecret;
        await apiPost<Utilisateur>('/api/utilisateurs', payload);
      } else {
        payload.rolesSupplementaires = rolesSupplementaires;
        await apiPatch(`/api/utilisateurs/${mode.utilisateur.id}`, payload);
      }
      // Succès : le brouillon n'a plus lieu d'être.
      clearDraft(draftKey);
      onSaved();
    } catch (err) {
      // Échec : la modale reste ouverte et tout ce qui a été saisi reste en
      // place (state + brouillon déjà sauvegardé) — rien n'est perdu.
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={mode.kind === 'create' ? 'Ajouter utilisateur' : `Modifier — ${existant!.nomComplet}`} onClose={onClose}>
      {draftRestaure && (
        <div className="mb-1 flex items-center justify-between gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          <span>
            Brouillon restauré — vos dernières saisies non enregistrées ont été récupérées.
            {photosNonSauvegardees && ' (photos non conservées, trop volumineuses)'}
          </span>
          <button type="button" onClick={ignorerBrouillon} className="shrink-0 font-semibold underline">
            Ignorer
          </button>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} onChange={handleFormChange} className="flex flex-col gap-4">
        {avecPhoto && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="Photo" className="h-full w-full object-cover" />
              ) : (
                <Upload className="h-6 w-6 opacity-40" />
              )}
            </div>
            <label className="btn-outline cursor-pointer px-2 py-1 text-xs">
              Choisir la photo
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>
          </div>
        )}

        <div className="form-grid">
          <Field label="Nom complet" required>
            <input
              className="input-basic"
              name="nomComplet"
              defaultValue={draft?.nomComplet ?? existant?.nomComplet ?? ''}
              required
            />
          </Field>
          <Field label="Fonction">
            <select className="input-basic" value={role} onChange={(e) => handleRoleChange(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Téléphone" required>
            <input
              className="input-basic"
              name="telephone"
              type="tel"
              placeholder="06XXXXXXXX"
              defaultValue={draft?.telephone ?? existant?.telephone ?? ''}
              required
            />
          </Field>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Adresse électronique{estTerrain ? ' *' : ''}
            <input
              type="email"
              className="input-basic"
              name="email"
              defaultValue={draft?.email ?? existant?.email ?? ''}
              required={estTerrain}
            />
          </label>

          {avecHub && (
            <Field label="Hub de rattachement" required>
              <select
                className="input-basic"
                name="hubId"
                value={hubId}
                onChange={(e) => setHubId(e.target.value)}
                required
              >
                <option value="">Sélectionner un hub</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.nom}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {mode.kind === 'edit' && (
            <div className="form-field sm:col-span-2">
              <span className="form-label">Rôles supplémentaires</span>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {ROLES.filter((r) => r !== role && espaceDe(r) === espaceDe(role)).map((r) => (
                  <label key={r} className="check-row font-normal">
                    <input
                      type="checkbox"
                      className="check-basic"
                      checked={rolesSupplementaires.includes(r)}
                      onChange={() => toggleRoleSupplementaire(r)}
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
              <span className="form-hint">
                Accès ponctuel à d&apos;autres fonctions du même espace, sans changer la fonction principale.
              </span>
            </div>
          )}

          {/* Permissions du back-office : ce que ce compte peut ouvrir, module
              par module. Masqué pour les fonctions terrain (livreur,
              ramasseur), dont l'accès est gouverné par le rôle et le domaine
              et non par ce catalogue. */}
          {!estTerrain && (
            <div className="form-field sm:col-span-2">
              <span className="form-label">Permissions</span>
              <span className="form-hint">
                Les cases cochées déterminent les modules accessibles à ce compte.{' '}
                {mode.kind === 'create'
                  ? 'Pré-remplies selon la fonction choisie — ajustez-les librement.'
                  : 'Décocher une case retire immédiatement l’accès, sans reconnexion.'}
              </span>
              <div className="mt-2 flex flex-col gap-3">
                {PERMISSION_CATALOG.map((cat) => {
                  const cles = cat.permissions.map((p) => p.key);
                  const toutCoche = cles.every((k) => permissions.includes(k));
                  return (
                    <fieldset key={cat.category} className="rounded-md border border-[var(--border,#e5e7eb)] p-3">
                      <legend className="flex items-center gap-3 px-1 text-sm font-medium">
                        {cat.category}
                        <button
                          type="button"
                          className="text-xs font-normal underline opacity-70 hover:opacity-100"
                          onClick={() => toggleCategorie(cles, toutCoche)}
                        >
                          {toutCoche ? 'Tout décocher' : 'Tout cocher'}
                        </button>
                      </legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {cat.permissions.map((p) => (
                          <label key={p.key} className="check-row font-normal" title={p.description}>
                            <input
                              type="checkbox"
                              className="check-basic"
                              checked={permissions.includes(p.key)}
                              onChange={() => togglePermission(p.key)}
                            />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </div>
          )}

          {estTerrain && (
            <>
              <Field label="CIN" required>
                <input className="input-basic" name="cin" defaultValue={draft?.cin ?? existant?.cin ?? ''} required />
              </Field>
              <div />

              <Field label="Zone principale">
                <select className="input-basic" name="zonePrincipale" defaultValue={draft?.zonePrincipale ?? existant?.zonePrincipale ?? ''}>
                  <option value="">Zone</option>
                  {VILLES_RAMASSAGE.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Zone secondaire">
                <select className="input-basic" name="zoneSecondaire" defaultValue={draft?.zoneSecondaire ?? existant?.zoneSecondaire ?? ''}>
                  <option value="">Zone</option>
                  {VILLES_RAMASSAGE.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Adresse" className="sm:col-span-2">
                <input className="input-basic" name="adresse" defaultValue={draft?.adresse ?? existant?.adresse ?? ''} />
              </Field>

              <Field label="Nom de la banque">
                <select className="input-basic" name="nomBanque" defaultValue={draft?.nomBanque ?? existant?.nomBanque ?? ''}>
                  <option value="">Nom Du Banque</option>
                  {BANQUES_MAROC.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Numéro de compte">
                <input
                  className="input-basic"
                  name="numeroCompte"
                  defaultValue={draft?.numeroCompte ?? existant?.numeroCompte ?? ''}
                />
              </Field>

              <Field label="Frais de livraison">
                <Affix suffix="DH">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    className="input-bare"
                    name="fraisLivraison"
                    defaultValue={draft?.fraisLivraison ?? existant?.fraisLivraison ?? ''}
                  />
                </Affix>
              </Field>
              <Field label="Frais de refus">
                <Affix suffix="DH">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    className="input-bare"
                    name="fraisRefus"
                    defaultValue={draft?.fraisRefus ?? existant?.fraisRefus ?? ''}
                  />
                </Affix>
              </Field>
            </>
          )}
        </div>

        {estTerrain && (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
            {PIECES.map(({ key, label }) => {
              const [value] = pieces[key];
              return (
                <div key={key} className="flex flex-col items-center gap-1.5 text-center text-xs">
                  <span className="font-semibold text-teal-600">{label}</span>
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5">
                    {value ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={value} alt={label} className="h-full w-full object-cover" />
                    ) : (
                      <Upload className="h-5 w-5 opacity-40" />
                    )}
                  </div>
                  {value ? (
                    <button
                      type="button"
                      onClick={() => {
                        pieces[key][1](null);
                        saveDraftNow({ [key]: null });
                      }}
                      className="flex items-center gap-1 text-teal-600 hover:underline"
                    >
                      <X className="h-3 w-3" /> Supprimer
                    </button>
                  ) : (
                    <label className="cursor-pointer text-teal-600 hover:underline">
                      Choisir
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePieceChange(key, e)} />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mode.kind === 'create' && (
          <div className="form-grid">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Mot de passe * <span className="text-xs font-normal opacity-60">(8+ car., maj. + chiffre + spécial)</span>
              <span className="input-basic flex items-center gap-2 py-0">
                <input
                  type={showSecret ? 'text' : 'password'}
                  className="w-full border-0 bg-transparent py-2 outline-none"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                  minLength={8}
                />
                <button type="button" onClick={() => setShowSecret((v) => !v)} className="opacity-60" tabIndex={-1}>
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>
            <Field label="Confirmation de mot de passe" required>
              <span className="input-basic flex items-center gap-2 py-0">
                <input
                  type={showConfirmSecret ? 'text' : 'password'}
                  className="w-full border-0 bg-transparent py-2 outline-none"
                  value={confirmSecret}
                  onChange={(e) => setConfirmSecret(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmSecret((v) => !v)}
                  className="opacity-60"
                  tabIndex={-1}
                >
                  {showConfirmSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </Field>
          </div>
        )}

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
