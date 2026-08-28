'use client';

import { useState } from 'react';
import { Check, Minus, Save } from 'lucide-react';
import { apiPatch, apiPost } from '@/lib/api-client';

export interface LigneStock {
  id: string;
  nom: string;
  reference: string;
  quantiteRecue: number;
  quantiteEnCours: number;
  rayonnage: string | null;
  receptionUrl: string;
  retraitUrl: string;
  rayonnageUrl: string;
}

export function LigneStockRow({
  ligne,
  deverouille,
  onChanged,
}: {
  ligne: LigneStock;
  deverouille: boolean;
  onChanged: () => void;
}) {
  const [aValider, setAValider] = useState('');
  const [aRetirer, setARetirer] = useState('');
  const [rayonnage, setRayonnage] = useState(ligne.rayonnage ?? '');
  const [busy, setBusy] = useState<'reception' | 'retrait' | 'rayonnage' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function valider() {
    setErreur(null);
    const quantite = aValider.trim() ? Number(aValider) : ligne.quantiteEnCours;
    if (!Number.isFinite(quantite) || quantite <= 0 || quantite > ligne.quantiteEnCours) {
      setErreur('Quantité à valider invalide');
      return;
    }
    setBusy('reception');
    try {
      await apiPost(ligne.receptionUrl, { quantite });
      setAValider('');
      onChanged();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function retirer() {
    setErreur(null);
    const quantite = Number(aRetirer);
    if (!Number.isFinite(quantite) || quantite <= 0 || quantite > ligne.quantiteRecue) {
      setErreur('Quantité à retirer invalide');
      return;
    }
    setBusy('retrait');
    try {
      await apiPost(ligne.retraitUrl, { quantite });
      setARetirer('');
      onChanged();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function enregistrerRayonnage() {
    setErreur(null);
    setBusy('rayonnage');
    try {
      await apiPatch(ligne.rayonnageUrl, { rayonnage: rayonnage.trim() || null });
      onChanged();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <tr>
        <td className="font-mono text-xs">{ligne.reference}</td>
        <td className="font-medium">{ligne.nom}</td>
        <td className="text-right tabular-nums">{ligne.quantiteRecue}</td>
        <td>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max={ligne.quantiteEnCours}
              className="input-basic w-20 bg-green-500/10 py-1"
              placeholder={String(ligne.quantiteEnCours)}
              value={aValider}
              onChange={(e) => setAValider(e.target.value)}
              disabled={!deverouille || ligne.quantiteEnCours === 0}
            />
            <button
              type="button"
              onClick={valider}
              disabled={busy !== null || !deverouille || ligne.quantiteEnCours === 0}
              className="btn-icon bg-green-600 text-white shadow-sm hover:brightness-105"
              title="Ajouter au stock reçu"
              aria-label={`Valider la réception de ${ligne.nom}`}
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </td>
        <td>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max={ligne.quantiteRecue}
              className="input-basic w-20 bg-red-500/10 py-1"
              placeholder="0"
              value={aRetirer}
              onChange={(e) => setARetirer(e.target.value)}
              disabled={!deverouille || ligne.quantiteRecue === 0}
            />
            <button
              type="button"
              onClick={retirer}
              disabled={busy !== null || !deverouille || ligne.quantiteRecue === 0}
              className="btn-icon bg-red-600 text-white shadow-sm hover:brightness-105"
              title="Retirer du stock reçu"
              aria-label={`Retirer du stock de ${ligne.nom}`}
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </td>
        <td>
          <div className="flex items-center gap-1.5">
            <input
              className="input-basic w-32 py-1"
              value={rayonnage}
              onChange={(e) => setRayonnage(e.target.value)}
              placeholder="Ex. A-12"
            />
            <button
              type="button"
              onClick={enregistrerRayonnage}
              disabled={busy !== null}
              className="btn-outline p-1.5"
              title="Enregistrer le rayonnage"
              aria-label={`Enregistrer le rayonnage de ${ligne.nom}`}
            >
              <Save className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {erreur && (
        <tr>
          <td colSpan={6} className="pt-0 pb-2 text-xs font-medium text-red-600">
            {erreur}
          </td>
        </tr>
      )}
    </>
  );
}
