'use client';

import { useEffect, useState } from 'react';
import { UserPlus, Trash2, Users } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import type { MarchandMembre } from '@/lib/types';
import { Field } from '@/components/form/Field';

// Le titulaire du compte invite des membres d'équipe avec juste un email +
// mot de passe (pas de téléphone) : ils accèdent à toutes les données de la
// boutique (colis, BL, ramassages…) et se connectent avec cet email — voir
// /api/marchands/membres et lib/marchand-scope.ts.
export function EquipeSection() {
  const [membres, setMembres] = useState<MarchandMembre[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [form, setForm] = useState({ nomComplet: '', email: '', secret: '' });

  async function load() {
    try {
      const res = await apiGet<{ data: MarchandMembre[] }>('/api/marchands/membres');
      setMembres(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnvoiEnCours(true);
    try {
      await apiPost('/api/marchands/membres', form);
      setForm({ nomComplet: '', email: '', secret: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await apiDelete(`/api/marchands/membres/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-black">
        <Users className="h-5 w-5" />
        Équipe
      </h2>
      <p className="mb-4 max-w-md text-sm opacity-70">
        Donnez accès à votre boutique à un collaborateur : il se connectera avec l&apos;email et le mot de passe
        choisis ici, sans besoin de numéro de téléphone.
      </p>

      <ul className="mb-4 flex flex-col gap-1 text-sm">
        {membres.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-lg border-l-4 border-brand bg-black/5 px-3 py-2 dark:bg-white/5"
          >
            <span className="min-w-0 truncate">
              <strong>{m.utilisateur.nomComplet}</strong> — {m.utilisateur.email}
              {!m.utilisateur.actif && <span className="ml-2 text-xs opacity-60">(désactivé)</span>}
            </span>
            <button
              onClick={() => handleRevoke(m.id)}
              className="shrink-0 text-red-600 transition hover:opacity-70"
              aria-label={`Retirer ${m.utilisateur.nomComplet}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {membres.length === 0 && <li className="opacity-60">Aucun membre d&apos;équipe pour le moment</li>}
      </ul>

      <form onSubmit={handleInvite} className="form-section max-w-md">
        <Field label="Nom complet" required>
          <input
            className="input-basic"
            placeholder="Ex. Salma Bennani"
            value={form.nomComplet}
            onChange={(e) => setForm({ ...form, nomComplet: e.target.value })}
            required
          />
        </Field>
        <Field label="Email" required hint="C'est avec cet email que le collaborateur se connectera.">
          <input
            className="input-basic"
            type="email"
            placeholder="collaborateur@exemple.ma"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </Field>
        <Field label="Mot de passe" required hint="8 caractères minimum, avec majuscule, chiffre et caractère spécial.">
          <input
            className="input-basic"
            type="password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            minLength={8}
            required
          />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={envoiEnCours} className="btn-outline flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            {envoiEnCours ? 'Ajout…' : 'Ajouter un membre'}
          </button>
        </div>
      </form>
    </div>
  );
}
