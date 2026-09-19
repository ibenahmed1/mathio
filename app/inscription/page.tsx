'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { Logo } from '@/components/Logo';

// § Inscription progressive.
//
// Ce formulaire demandait autrefois tout le dossier d'un coup — CIN, adresse,
// RIB, justificatif bancaire — avant même de laisser entrer. Il ne demande
// plus que de quoi ouvrir un compte : une adresse électronique, un mot de
// passe et le nom de la boutique. Le nom du responsable et le téléphone sont
// proposés, mais facultatifs.
//
// Le reste du dossier se complète depuis /marchand/profil, et c'est lui qui
// ouvre les bons, les ramassages et les factures (lib/marchand-activation.ts).
// Le marchand peut donc, dès la minute qui suit, saisir ses colis et inviter
// son équipe — ce qu'il ne pouvait pas faire tant que cette page exigeait une
// photo de RIB.

interface InscriptionForm {
  nomComplet: string;
  email: string;
  telephone: string;
  nomBoutique: string;
  secret: string;
  confirmSecret: string;
}

const INITIAL_FORM: InscriptionForm = {
  nomComplet: '',
  email: '',
  telephone: '',
  nomBoutique: '',
  secret: '',
  confirmSecret: '',
};

export default function InscriptionPage() {
  return (
    <Suspense fallback={null}>
      <InscriptionFormulaire />
    </Suspense>
  );
}

function InscriptionFormulaire() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Pré-remplissage depuis un lien "Créer le compte" (ex. import de colis
  // admin, marchand identifié par email ou téléphone introuvable en base) —
  // returnTo ramène l'admin là d'où il vient une fois le compte créé.
  const emailPrefill = searchParams.get('email') ?? '';
  const telephonePrefill = searchParams.get('telephone') ?? '';
  const returnTo = searchParams.get('returnTo');

  const [form, setForm] = useState<InscriptionForm>(() => ({
    ...INITIAL_FORM,
    email: emailPrefill,
    telephone: telephonePrefill,
  }));
  const [showSecret, setShowSecret] = useState(false);
  const [showConfirmSecret, setShowConfirmSecret] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof InscriptionForm>(key: K, value: InscriptionForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (form.secret !== form.confirmSecret) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        nomComplet: form.nomComplet,
        email: form.email,
        telephone: form.telephone,
        nomBoutique: form.nomBoutique,
        secret: form.secret,
      };
      const res = await apiPost<{ message: string }>('/api/marchands/inscription', payload);
      if (returnTo) {
        router.push(returnTo);
        return;
      }
      setMessage(res.message);
      setForm(INITIAL_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-brand p-4 sm:p-8">
      <Logo size="lg" />
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg sm:p-8">
        <h1 className="text-xl font-black text-black">Inscription marchand</h1>
        <p className="mb-6 mt-2 text-sm text-black/60">
          Créez votre compte en une minute. Vous compléterez vos informations (téléphone, CIN, adresse, RIB) depuis
          votre espace, quand vous voudrez : ce sont elles qui débloquent les bons, les ramassages et les factures.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Nom complet
              <input
                className="input-underline"
                value={form.nomComplet}
                onChange={(e) => update('nomComplet', e.target.value)}
                autoComplete="name"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Numéro de téléphone
              <input
                className="input-underline"
                type="tel"
                placeholder="06XXXXXXXX"
                value={form.telephone}
                onChange={(e) => update('telephone', e.target.value)}
                autoComplete="tel"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Adresse electronique *
              <input
                type="email"
                className="input-underline"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Nom du magasin *
              <input
                className="input-underline"
                value={form.nomBoutique}
                onChange={(e) => update('nomBoutique', e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Mot de passe * <span className="text-xs font-normal opacity-60">(8+ car., maj. + chiffre + spécial)</span>
              <span className="flex items-center gap-2 border-b border-black/20 focus-within:border-brand">
                <input
                  type={showSecret ? 'text' : 'password'}
                  className="input-underline border-0"
                  value={form.secret}
                  onChange={(e) => update('secret', e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                {/* p-2 pour la cible tactile, -mr-2 pour que l'icône garde sa place. */}
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="-mr-2 p-2 text-black/40"
                  tabIndex={-1}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Confirmation de mot de passe *
              <span className="flex items-center gap-2 border-b border-black/20 focus-within:border-brand">
                <input
                  type={showConfirmSecret ? 'text' : 'password'}
                  className="input-underline border-0"
                  value={form.confirmSecret}
                  onChange={(e) => update('confirmSecret', e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmSecret((v) => !v)}
                  className="-mr-2 p-2 text-black/40"
                  tabIndex={-1}
                >
                  {showConfirmSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          {message && <p className="text-sm font-medium text-green-700">{message}</p>}

          <button type="submit" disabled={loading} className="btn-gradient">
            {loading ? 'Envoi…' : 'Créer mon compte'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-black/60">
          Vous avez déjà un compte ?{' '}
          <a href="/login" className="-my-2 inline-block py-2 font-semibold text-brand-foreground underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
