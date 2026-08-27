'use client';

import { useState } from 'react';
import { Modal } from '@/components/admin/Modal';
import type { ModeReglementLivreur } from '@/lib/types';

// Saisie du décaissement (§ /admin/bon-paiement). Partagée par le tableau de
// bord (action rapide « Marquer comme payé ») et par le détail d'un bon : la
// même règle métier — pas de virement ni de chèque sans référence — doit
// s'appliquer aux deux, et deux formulaires jumeaux finiraient par diverger.
const MODES: { valeur: ModeReglementLivreur; label: string; referenceRequise: boolean }[] = [
  { valeur: 'virement', label: 'Virement bancaire', referenceRequise: true },
  { valeur: 'cheque', label: 'Chèque', referenceRequise: true },
  // Espèces : la trace, c'est la signature du livreur sur le bon papier, pas
  // une référence tapée au clavier.
  { valeur: 'especes', label: 'Espèces', referenceRequise: false },
];

export function ModaleReglement({
  numero,
  beneficiaire,
  montant,
  enCours,
  onClose,
  onConfirmer,
}: {
  numero: string;
  beneficiaire: string;
  montant: string;
  enCours: boolean;
  onClose: () => void;
  onConfirmer: (modeReglement: ModeReglementLivreur, referenceReglement: string) => void;
}) {
  const [mode, setMode] = useState<ModeReglementLivreur>('virement');
  const [reference, setReference] = useState('');

  const referenceRequise = MODES.find((m) => m.valeur === mode)?.referenceRequise ?? false;
  const pretAValider = !referenceRequise || reference.trim().length > 0;

  return (
    <Modal title={`Régler ${numero}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Versement de <span className="font-mono font-bold">{montant}</span> à{' '}
          <span className="font-medium">{beneficiaire}</span>. Une écriture comptable en catégorie{' '}
          <span className="font-medium">Salaire</span> sera générée.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide opacity-60">Mode de règlement</span>
          <select
            className="input-basic"
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeReglementLivreur)}
          >
            {MODES.map((m) => (
              <option key={m.valeur} value={m.valeur}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide opacity-60">
            Référence {referenceRequise ? '' : '(facultative)'}
          </span>
          <input
            className="input-basic"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={mode === 'cheque' ? 'N° de chèque' : 'N° de virement / ordre'}
          />
          {referenceRequise && (
            <span className="text-xs opacity-60">
              Obligatoire : c&apos;est la seule preuve opposable si le livreur conteste le versement.
            </span>
          )}
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline">
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={enCours || !pretAValider}
            onClick={() => onConfirmer(mode, reference.trim())}
          >
            {enCours ? 'Enregistrement…' : 'Confirmer le paiement'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
