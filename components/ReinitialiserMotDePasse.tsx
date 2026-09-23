'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';

// Petit formulaire "nouveau mot de passe + confirmation" saisi et validé par
// l'admin lui-même — utilisé aussi bien pour les comptes équipe
// (app/admin/equipe) que marchands (app/admin/marchands), qui appellent tous
// les deux le même endpoint /api/utilisateurs/:id/reinitialiser-mot-de-passe.
//
// Fenêtre et non panneau posé dans la ligne : ouvert en place, le formulaire
// atterrissait dans la dernière colonne d'une table qui défile
// horizontalement dans son cadre, et l'`autoFocus` du premier champ faisait
// alors défiler cadre ET page pour aller chercher un champ hors écran — la
// vue sautait ailleurs et l'admin ne voyait plus le formulaire qu'il venait
// d'ouvrir. Les autres actions de ligne de ces écrans (modifier un compte,
// tarifs par ville) passent déjà par Modal.
export function ReinitialiserMotDePasse({
  utilisateurId,
  nomComplet,
  onDone,
}: {
  utilisateurId: string;
  nomComplet?: string;
  onDone: () => void;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleValider() {
    setError(null);
    if (motDePasse.length < 8 || !/[A-Z]/.test(motDePasse) || !/[0-9]/.test(motDePasse) || !/[^A-Za-z0-9]/.test(motDePasse)) {
      setError('8 caractères min., avec majuscule, chiffre et caractère spécial');
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
    <Modal
      title={nomComplet ? `Réinitialiser le mot de passe — ${nomComplet}` : 'Réinitialiser le mot de passe'}
      onClose={onDone}
      size="sm"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          // Un vrai <form> pour que « Entrée » valide et que le gestionnaire
          // de mots de passe du navigateur reconnaisse la saisie ; le submit
          // natif est neutralisé, l'envoi passe par fetch.
          e.preventDefault();
          if (!loading) handleValider();
        }}
      >
        <input
          type="password"
          autoComplete="new-password"
          className="input-basic"
          placeholder="Nouveau mot de passe (8+ car., maj/chiffre/spécial)"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          autoComplete="new-password"
          className="input-basic"
          placeholder="Confirmation"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onDone} className="btn-outline">
            Annuler
          </button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Enregistrement…' : 'Valider'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
