'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/api-client';
import { Logo } from '@/components/Logo';

interface LoginResponse {
  id: string;
  nomComplet: string;
  role: string;
}

// Toujours un chemin de l'hôte courant : chaque espace a son propre domaine,
// et l'API refuse d'ouvrir une session pour un rôle qui n'appartient pas à
// l'espace de cet hôte. Une connexion réussie ici atterrit donc forcément sur
// une page du même domaine.
function destinationForRole(role: string) {
  if (role === 'marchand') return '/marchand';
  if (role === 'ramasseur') return '/ramasseur';
  if (role === 'livreur') return '/livreur';
  if (role === 'design' || role === 'gestionnaire_hub') return '/admin/tasks';
  if (role === 'planner') return '/admin/planification';
  if (role === 'agent_hub') return '/admin/scan/reception';
  return '/admin/commandes';
}

// L'API renvoie une URL absolue quand des identifiants valides sont saisis sur
// le mauvais domaine PUBLIC (ex. un livreur sur le portail marchand) — jamais
// vers le back-office, dont l'existence n'est divulguée depuis aucun des deux
// autres domaines. Voir POST /api/auth/login.
function redirectionEspace(err: unknown): string | null {
  if (!(err instanceof ApiRequestError)) return null;
  const details = err.details as { redirectTo?: unknown } | null;
  return typeof details?.redirectTo === 'string' ? details.redirectTo : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [telephone, setTelephone] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await apiPost<LoginResponse>('/api/auth/login', { telephone, secret });
      router.push(destinationForRole(user.role));
    } catch (err) {
      const ailleurs = redirectionEspace(err);
      if (ailleurs) {
        // Changement de domaine : hors du périmètre du routeur Next.
        window.location.href = ailleurs;
        return;
      }
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand p-8">
      <Logo size="lg" />
      <div className="w-full max-w-sm rounded-xl bg-black p-6 shadow-lg">
        <h1 className="mb-4 text-xl font-black text-white">Connexion</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-white/80">
            Téléphone ou email
            <input
              className="input-basic border-white/20 bg-white/5 text-white placeholder:text-white/30"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="0000000000 ou email"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-white/80">
            Mot de passe / PIN
            <input
              className="input-basic border-white/20 bg-white/5 text-white"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm font-medium text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary mt-2">
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <p className="mt-2 text-xs text-white/50">
          <a className="font-semibold text-brand underline" href="/mot-de-passe-oublie">
            Mot de passe oublié ?
          </a>
        </p>
        <p className="mt-2 text-xs text-white/50">
          Pas de compte ?{' '}
          <a className="font-semibold text-brand underline" href="/inscription">
            Inscrire ma boutique
          </a>
        </p>
      </div>
    </main>
  );
}
