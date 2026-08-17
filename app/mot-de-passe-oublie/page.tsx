'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { Logo } from '@/components/Logo';

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await apiPost<{ message: string }>('/api/auth/mot-de-passe-oublie', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand p-8">
      <Logo size="lg" />
      <div className="w-full max-w-sm rounded-xl bg-black p-6 shadow-lg">
        <h1 className="mb-2 text-xl font-black text-white">Mot de passe oublié</h1>
        <p className="mb-4 text-sm text-white/60">
          Cette option est réservée aux comptes marchands (les seuls avec un email enregistré). Pour les autres
          comptes, contacte un administrateur.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-white/80">
            Email
            <input
              className="input-basic border-white/20 bg-white/5 text-white placeholder:text-white/30"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
              required
            />
          </label>
          {error && <p className="text-sm font-medium text-red-400">{error}</p>}
          {message && <p className="text-sm font-medium text-green-400">{message}</p>}
          <button type="submit" disabled={loading} className="btn-primary mt-2">
            {loading ? 'Envoi…' : 'Envoyer le lien'}
          </button>
        </form>
        <p className="mt-4 text-xs text-white/50">
          <a className="font-semibold text-brand underline" href="/login">
            Retour à la connexion
          </a>
        </p>
      </div>
    </main>
  );
}
