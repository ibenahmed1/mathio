'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { Logo } from '@/components/Logo';
import { VILLES_RAMASSAGE, BANQUES_MAROC, LABELS_TYPE_COMPTE, TYPES_COMPTE } from '@/lib/marchand-form-options';
import type { TypeCompteMarchand } from '@/app/generated/prisma/enums';

const RIB_MAX_LENGTH = 24;

interface InscriptionForm {
  nomComplet: string;
  cin: string;
  nomBoutique: string;
  telephone: string;
  siteWeb: string;
  email: string;
  secret: string;
  confirmSecret: string;
  ville: string;
  adresse: string;
  nomBanque: string;
  rib: string;
  ribPhotoUrl: string;
  typeCompte: TypeCompteMarchand;
  registreCommerce: string;
  villeRamassage: string;
}

const INITIAL_FORM: InscriptionForm = {
  nomComplet: '',
  cin: '',
  nomBoutique: '',
  telephone: '',
  siteWeb: '',
  email: '',
  secret: '',
  confirmSecret: '',
  ville: '',
  adresse: '',
  nomBanque: '',
  rib: '',
  ribPhotoUrl: '',
  typeCompte: 'marchand',
  registreCommerce: '',
  villeRamassage: VILLES_RAMASSAGE[0],
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function InscriptionPage() {
  const [form, setForm] = useState<InscriptionForm>(INITIAL_FORM);
  const [ribPhotoName, setRibPhotoName] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [showConfirmSecret, setShowConfirmSecret] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof InscriptionForm>(key: K, value: InscriptionForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRibPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setRibPhotoName(null);
      update('ribPhotoUrl', '');
      return;
    }
    setRibPhotoName(file.name);
    update('ribPhotoUrl', await readFileAsDataUrl(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (form.secret !== form.confirmSecret) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    if (!/^\d{24}$/.test(form.rib)) {
      setError('Le RIB doit contenir exactement 24 chiffres');
      return;
    }
    if (!form.ribPhotoUrl) {
      setError('La photo du RIB est requise');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        nomComplet: form.nomComplet,
        cin: form.cin,
        nomBoutique: form.nomBoutique,
        telephone: form.telephone,
        siteWeb: form.siteWeb,
        email: form.email,
        secret: form.secret,
        ville: form.ville,
        adresse: form.adresse,
        nomBanque: form.nomBanque,
        rib: form.rib,
        ribPhotoUrl: form.ribPhotoUrl,
        typeCompte: form.typeCompte,
        registreCommerce: form.registreCommerce,
        villeRamassage: form.villeRamassage,
      };
      const res = await apiPost<{ message: string }>('/api/marchands/inscription', payload);
      setMessage(res.message);
      setForm(INITIAL_FORM);
      setRibPhotoName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand p-8">
      <Logo size="lg" />
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-lg sm:p-8">
        <h1 className="mb-6 text-xl font-black text-black">Inscription marchand</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Nom complet *
              <input
                className="input-underline"
                value={form.nomComplet}
                onChange={(e) => update('nomComplet', e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              CIN *
              <input className="input-underline" value={form.cin} onChange={(e) => update('cin', e.target.value)} required />
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
              Numéro de téléphone *
              <input
                className="input-underline"
                value={form.telephone}
                onChange={(e) => update('telephone', e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Site web
              <input className="input-underline" value={form.siteWeb} onChange={(e) => update('siteWeb', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Adresse electronique *
              <input
                type="email"
                className="input-underline"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Mot de passe *
              <span className="flex items-center gap-2 border-b border-black/20 focus-within:border-brand">
                <input
                  type={showSecret ? 'text' : 'password'}
                  className="input-underline border-0"
                  value={form.secret}
                  onChange={(e) => update('secret', e.target.value)}
                  required
                  minLength={4}
                />
                <button type="button" onClick={() => setShowSecret((v) => !v)} className="text-black/40" tabIndex={-1}>
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Confirmation de mot de passe
              <span className="flex items-center gap-2 border-b border-black/20 focus-within:border-brand">
                <input
                  type={showConfirmSecret ? 'text' : 'password'}
                  className="input-underline border-0"
                  value={form.confirmSecret}
                  onChange={(e) => update('confirmSecret', e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmSecret((v) => !v)}
                  className="text-black/40"
                  tabIndex={-1}
                >
                  {showConfirmSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Ville *
              <input className="input-underline" value={form.ville} onChange={(e) => update('ville', e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Adresse *
              <input
                className="input-underline"
                value={form.adresse}
                onChange={(e) => update('adresse', e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Nom du banque
              <select
                className="input-underline"
                value={form.nomBanque}
                onChange={(e) => update('nomBanque', e.target.value)}
              >
                <option value="">Nom du banque</option>
                {BANQUES_MAROC.map((banque) => (
                  <option key={banque} value={banque}>
                    {banque}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Le Rib ({RIB_MAX_LENGTH} chiffre) *
              <input
                className="input-underline"
                value={form.rib}
                onChange={(e) => update('rib', e.target.value.replace(/\D/g, '').slice(0, RIB_MAX_LENGTH))}
                inputMode="numeric"
                maxLength={RIB_MAX_LENGTH}
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium text-black">
            RIB Photo*
            <span className="flex items-center gap-3 rounded-md border border-black/20 px-3 py-2 text-sm text-black/60">
              <span className="rounded border border-black/40 bg-black/5 px-3 py-1 font-semibold text-black">
                Choisir un fichier
              </span>
              {ribPhotoName ?? "Aucun fichier n'a été sélectionné"}
              <input type="file" accept="image/*" className="hidden" onChange={handleRibPhotoChange} required />
            </span>
          </label>

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Type d&apos;entreprise
              <select
                className="input-underline"
                value={form.typeCompte}
                onChange={(e) => update('typeCompte', e.target.value as TypeCompteMarchand)}
              >
                {TYPES_COMPTE.map((type) => (
                  <option key={type} value={type}>
                    {LABELS_TYPE_COMPTE[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
              Registre de commerce
              <input
                className="input-underline"
                value={form.registreCommerce}
                onChange={(e) => update('registreCommerce', e.target.value)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium text-black/70">
            Ville de ramassage
            <select
              className="input-underline"
              value={form.villeRamassage}
              onChange={(e) => update('villeRamassage', e.target.value)}
            >
              {VILLES_RAMASSAGE.map((ville) => (
                <option key={ville} value={ville}>
                  {ville}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          {message && <p className="text-sm font-medium text-green-700">{message}</p>}

          <button type="submit" disabled={loading} className="btn-gradient">
            {loading ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-black/60">
          Vous avez déjà un compte ?{' '}
          <a href="/login" className="font-semibold text-brand-foreground underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
