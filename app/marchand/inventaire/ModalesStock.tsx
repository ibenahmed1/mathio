'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { referenceVariante } from '@/lib/sku';
import { Modal } from '@/components/admin/Modal';
import type { Produit } from '@/lib/types';

// § Gestion de stock — réassort d'un produit existant. La quantité est
// DÉCLARÉE (« en cours ») : elle ne devient du stock réel qu'une fois
// réceptionnée par l'entrepôt, comme à la création du produit.
export function ReassortModal({ produit, onClose, onDone }: { produit: Produit; onClose: () => void; onDone: () => void }) {
  const variantes = produit.variantesActivees ? produit.variantes ?? [] : [];
  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? '');
  const [quantite, setQuantite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function valider() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/produits/${produit.id}/reassort`, {
        quantite: Number(quantite),
        varianteId: produit.variantesActivees ? varianteId : undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Réassort — ${produit.nom}`} onClose={onClose}>
      <p className="text-sm opacity-70">
        Déclarez les unités que vous envoyez à l&apos;entrepôt. Elles apparaîtront « en cours » jusqu&apos;à leur
        réception.
      </p>
      {produit.variantesActivees && (
        <label className="flex flex-col gap-1 text-sm">
          Variante
          <select className="input-basic" value={varianteId} onChange={(e) => setVarianteId(e.target.value)}>
            {variantes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nom} ({v.reference})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Quantité envoyée
        <input
          className="input-basic"
          type="number"
          min={1}
          value={quantite}
          onChange={(e) => setQuantite(e.target.value)}
          autoFocus
        />
      </label>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button
          className="btn-primary"
          disabled={busy || !(Number(quantite) > 0) || (produit.variantesActivees && !varianteId)}
          onClick={valider}
        >
          Déclarer
        </button>
      </div>
    </Modal>
  );
}

// Nouvelle variante (couleur, taille…) d'un produit qui suit déjà ses
// variantes. Le SKU proposé suit le nom tant qu'il n'est pas modifié à la main.
export function AjouterVarianteModal({
  produit,
  onClose,
  onDone,
}: {
  produit: Produit;
  onClose: () => void;
  onDone: () => void;
}) {
  const [nom, setNom] = useState('');
  const [reference, setReference] = useState('');
  const [quantite, setQuantite] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changerNom(valeur: string) {
    if (reference === '' || reference === referenceVariante(produit.reference, nom)) {
      setReference(referenceVariante(produit.reference, valeur));
    }
    setNom(valeur);
  }

  async function valider() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/produits/${produit.id}/variantes`, {
        nom: nom.trim(),
        reference: reference.trim(),
        quantiteEnCours: Number(quantite) || 0,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Nouvelle variante — ${produit.nom}`} onClose={onClose}>
      <label className="flex flex-col gap-1 text-sm">
        Nom de la variante
        <input className="input-basic" value={nom} onChange={(e) => changerNom(e.target.value)} autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Référence (SKU)
        <input className="input-basic font-mono" value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Quantité envoyée à l&apos;entrepôt
        <input className="input-basic" type="number" min={0} value={quantite} onChange={(e) => setQuantite(e.target.value)} />
      </label>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button className="btn-primary" disabled={busy || !nom.trim() || !reference.trim()} onClick={valider}>
          Ajouter
        </button>
      </div>
    </Modal>
  );
}
