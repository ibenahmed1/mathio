'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api-client';

// Petit formulaire "nouveau mot de passe + confirmation" saisi et validé par
// l'admin lui-même — utilisé aussi bien pour les comptes équipe
// (app/admin/equipe) que marchands (app/admin/marchands), qui appellent tous
// les deux le même endpoint /api/utilisateurs/:id/reinitialiser-mot-de-passe.
export function ReinitialiserMotDePasse({ utilisateurId, onDone }: { utilisateurId: string; onDone: () => void }) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleValider() {
    setError(null);
    if (motDePasse.length < 4) {
      setError('4 caractères minimum');
      return;
    }
    if (motDePasse !== confirmation) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      await apiPost(`/api/utilisateurs/${utilisateurId}/reinitialiser-mot-de-passe`, {
        motDePasse,
        confirmationMotDePasse: confirmation,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-black/10 p-2 dark:border-white/10">
      <input
        type="password"
        className="input-basic px-2 py-1 text-xs"
        placeholder="Nouveau mot de passe"
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        autoFocus
      />
      <input
        type="password"
        className="input-basic px-2 py-1 text-xs"
        placeholder="Confirmation"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleValider}
          disabled={loading}
          className="btn-primary px-2 py-1 text-xs"
        >
          Valider
        </button>
        <button type="button" onClick={onDone} className="btn-outline px-2 py-1 text-xs">
          Annuler
        </button>
      </div>
    </div>
  );
}
