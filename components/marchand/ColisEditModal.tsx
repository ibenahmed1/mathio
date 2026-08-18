'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import type { Commande, Marchandise } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { ProduitSelect } from '@/components/ProduitSelect';

// Toute donnée saisie manuellement à la création reste modifiable ici — même
// logique de pré-remplissage du prix (marchandise × quantité) que le
// formulaire "Nouveau colis", champ toujours éditable ensuite.
export function ColisEditModal({
  commande,
  onClose,
  onSaved,
  champsRestreints,
}: {
  commande: Commande;
  onClose: () => void;
  onSaved: () => void;
  // Cf. ColisActionsMenu : depuis "Colis à relancer", n'autorise que la
  // correction du téléphone et de l'adresse (cause la plus fréquente
  // d'échec de livraison : numéro erroné / adresse incomplète).
  champsRestreints?: boolean;
}) {
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prixAuto, setPrixAuto] = useState(false);
  const [form, setForm] = useState({
    clientNom: commande.clientNom,
    clientTelephone: commande.clientTelephone,
    marchandiseId: commande.marchandiseId ?? '',
    quantite: String(commande.quantite ?? 1),
    ville: commande.ville,
    adresse: commande.adresse,
    montantCod: commande.montantCod,
    produitDescription: commande.produitDescription ?? '',
    produitId: commande.produitId ?? '',
    notes: commande.notes ?? '',
    colisARemplacerCode: commande.colisARemplacer?.codeSuivi ?? '',
    ouvrir: commande.ouvrir,
    fragile: commande.fragile,
    aRemplacer: commande.aRemplacer,
    enStock: commande.enStock,
  });

  useEffect(() => {
    apiGet<{ data: Marchandise[] }>('/api/marchandises')
      .then((res) => setMarchandises(res.data))
      .catch(() => {});
  }, []);

  const marchandiseSelectionnee = marchandises.find((m) => m.id === form.marchandiseId);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(
        `/api/commandes/${commande.id}`,
        champsRestreints
          ? {
              clientTelephone: form.clientTelephone,
              adresse: form.adresse,
            }
          : {
              clientNom: form.clientNom,
              clientTelephone: form.clientTelephone,
              ville: form.ville,
              adresse: form.adresse,
              marchandiseId: form.marchandiseId || null,
              quantite: Number(form.quantite) || 1,
              montantCod: form.montantCod,
              produitDescription: form.produitDescription,
              produitId: form.produitId || null,
              notes: form.notes,
              colisARemplacerCode: form.colisARemplacerCode,
              ouvrir: form.ouvrir,
              fragile: form.fragile,
              aRemplacer: form.aRemplacer,
              enStock: form.enStock,
            },
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  function recalculerPrix(marchandiseId: string, quantite: string) {
    const m = marchandises.find((x) => x.id === marchandiseId);
    if (!m) return;
    const qte = Number(quantite) || 1;
    setForm((f) => ({ ...f, montantCod: (Number(m.prix) * qte).toFixed(2) }));
    setPrixAuto(true);
  }

  return (
    <Modal title={`Modifier le colis — ${commande.codeSuivi}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {champsRestreints && (
          <p className="sm:col-span-2 -mt-1 text-xs opacity-60">
            Ce colis est en attente de relance : seuls le téléphone et l&apos;adresse sont modifiables.
          </p>
        )}

        {!champsRestreints && (
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            Destinataire <span className="text-red-600">*</span>
            <input
              className="input-basic"
              value={form.clientNom}
              onChange={(e) => setForm({ ...form, clientNom: e.target.value })}
              required
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Téléphone <span className="text-red-600">*</span>
          <input
            className="input-basic"
            value={form.clientTelephone}
            onChange={(e) => setForm({ ...form, clientTelephone: e.target.value })}
            required
          />
        </label>
        {!champsRestreints && (
          <label className="flex flex-col gap-1 text-sm">
            Ville <span className="text-red-600">*</span>
            <input
              className="input-basic"
              value={form.ville}
              onChange={(e) => setForm({ ...form, ville: e.target.value })}
              required
            />
          </label>
        )}
        <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
          Adresse <span className="text-red-600">*</span>
          <input
            className="input-basic"
            value={form.adresse}
            onChange={(e) => setForm({ ...form, adresse: e.target.value })}
            required
          />
        </label>

        {!champsRestreints && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Marchandise
              <select
                className="input-basic"
                value={form.marchandiseId}
                onChange={(e) => {
                  setForm({ ...form, marchandiseId: e.target.value });
                  recalculerPrix(e.target.value, form.quantite);
                }}
              >
                <option value="">Aucune…</option>
                {marchandises.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom} — {m.prix} DH
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Quantité
              <input
                className="input-basic"
                type="number"
                min="1"
                value={form.quantite}
                onChange={(e) => {
                  setForm({ ...form, quantite: e.target.value });
                  if (form.marchandiseId) recalculerPrix(form.marchandiseId, e.target.value);
                }}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Prix (DH)
              <div className="relative">
                <input
                  className="input-basic w-full pr-8"
                  type="number"
                  step="0.01"
                  value={form.montantCod}
                  onChange={(e) => {
                    setForm({ ...form, montantCod: e.target.value });
                    setPrixAuto(false);
                  }}
                />
                {prixAuto && (
                  <Sparkles className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" />
                )}
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Colis à remplacer
              <input
                className="input-basic"
                placeholder="Code de suivi"
                value={form.colisARemplacerCode}
                onChange={(e) => setForm({ ...form, colisARemplacerCode: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
              Description produit
              <input
                className="input-basic"
                value={form.produitDescription}
                onChange={(e) => setForm({ ...form, produitDescription: e.target.value })}
              />
            </label>

            <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
              Commentaire
              <textarea
                className="input-basic"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            <div className="sm:col-span-2 flex flex-wrap gap-4 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.ouvrir}
                  onChange={(e) => setForm({ ...form, ouvrir: e.target.checked })}
                />
                Ouvrir
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.fragile}
                  onChange={(e) => setForm({ ...form, fragile: e.target.checked })}
                />
                Fragile
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.aRemplacer}
                  onChange={(e) => setForm({ ...form, aRemplacer: e.target.checked })}
                />
                À remplacer (échange)
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.enStock}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, enStock: e.target.checked, produitId: e.target.checked ? f.produitId : '' }))
                  }
                />
                En stock (entrepôt)
              </label>
            </div>
            {form.enStock && (
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                Produit du stock
                <ProduitSelect
                  value={form.produitId}
                  onSelect={(produit) =>
                    setForm((f) => ({
                      ...f,
                      produitId: produit?.id ?? '',
                      produitDescription: produit ? produit.nom : f.produitDescription,
                    }))
                  }
                />
                <span className="text-xs opacity-50">Recherche par nom ou référence — pré-remplit la description</span>
              </label>
            )}
            <p className="sm:col-span-2 -mt-1 text-xs opacity-50">* Champs obligatoires</p>
          </>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </Modal>
  );
}
