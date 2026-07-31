'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api-client';
import { Logo } from '@/components/Logo';

function ReinitialiserMotDePasseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Lien invalide : le jeton de réinitialisation est manquant');
      return;
    }
    if (secret !== confirmSecret) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      await apiPost('/api/auth/reinitialiser-mot-de-passe', { token, secret });
      router.push('/login');
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
        <h1 className="mb-4 text-xl font-black text-white">Nouveau mot de passe</h1>
        {!token && (
          <p className="mb-4 text-sm font-medium text-red-400">
            Ce lien est invalide. Redemande une réinitialisation depuis la page de connexion.
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-white/80">
            Nouveau mot de passe
            <input
              className="input-basic border-white/20 bg-white/5 text-white"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-white/80">
            Confirmer le mot de passe
            <input
              className="input-basic border-white/20 bg-white/5 text-white"
              type="password"
              value={confirmSecret}
              onChange={(e) => setConfirmSecret(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm font-medium text-red-400">{error}</p>}
          <button type="submit" disabled={loading || !token} className="btn-primary mt-2">
            {loading ? 'Enregistrement…' : 'Réinitialiser'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ReinitialiserMotDePassePage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <ReinitialiserMotDePasseContent />
    </Suspense>
  );
}
