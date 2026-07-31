'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api-client';
import type { Utilisateur } from '@/lib/types';

export default function NouveauLivreurPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [genererAuto, setGenererAuto] = useState(true);
  const [form, setForm] = useState({ nomComplet: '', telephone: '', secret: '' });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiPost<Utilisateur & { secretTemporaire?: string }>('/api/utilisateurs', {
        nomComplet: form.nomComplet,
        telephone: form.telephone,
        role: 'livreur',
        secret: genererAuto ? undefined : form.secret,
      });
      if (res.secretTemporaire) {
        // Alerte bloquante : on ne repasse jamais par cette page une fois le
        // compte créé, donc ce mot de passe généré doit être communiqué
        // maintenant — il ne sera plus jamais affiché ensuite.
        window.alert(
          `Compte livreur créé pour "${form.nomComplet}".\n\n` +
            `Identifiant (téléphone) : ${form.telephone}\n` +
            `Mot de passe temporaire : ${res.secretTemporaire}\n\n` +
            `Communique ces informations à la personne concernée.`
        );
      }
      router.push('/admin/equipe');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Nouveau livreur</h1>

      <form onSubmit={handleCreate} className="flex max-w-md flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <input
          className="input-basic"
          placeholder="Nom complet"
          value={form.nomComplet}
          onChange={(e) => setForm({ ...form, nomComplet: e.target.value })}
          required
        />
        <input
          className="input-basic"
          placeholder="Téléphone"
          value={form.telephone}
          onChange={(e) => setForm({ ...form, telephone: e.target.value })}
          required
        />

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand"
            checked={genererAuto}
            onChange={(e) => setGenererAuto(e.target.checked)}
          />
          Générer le mot de passe automatiquement (recommandé)
        </label>

        {genererAuto ? (
          <p className="-mt-2 text-xs opacity-60">
            Un mot de passe temporaire sera créé et affiché une seule fois après la création du compte.
          </p>
        ) : (
          <input
            className="input-basic"
            placeholder="Mot de passe / PIN (4 caractères min.)"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            required
          />
        )}

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <button type="submit" className="btn-primary">
          Créer le compte livreur
        </button>
      </form>
    </div>
  );
}
