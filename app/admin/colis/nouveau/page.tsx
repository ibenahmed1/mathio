'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackagePlus, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Marchand, Marchandise } from '@/lib/types';

// Champs et exigences alignés sur /marchand/colis/nouveau (Field marque les
// champs requis par un "*" final, comme sur le formulaire marchand) — seul
// le sélecteur de marchand est propre à l'admin, puisqu'il est implicite
// côté marchand.
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const requis = label.endsWith(' *');
  const libelle = requis ? label.slice(0, -2) : label;
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wide opacity-60">
        {libelle}
        {requis && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs opacity-50">{hint}</span>}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="col-span-2 mt-1 text-sm font-bold uppercase tracking-wide text-black/70 first:mt-0 dark:text-white/70">{children}</h2>;
}

export default function AdminNouveauColisPage() {
  const router = useRouter();
  const [marchands, setMarchands] = useState<Marchand[]>([]);
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prixAuto, setPrixAuto] = useState(false);
  const [form, setForm] = useState({
    marchandId: '',
    clientNom: '',
    clientTelephone: '',
    marchandiseId: '',
    quantite: '1',
    ville: '',
    adresse: '',
    montantCod: '',
    produitDescription: '',
    notes: '',
    colisARemplacerCode: '',
    ouvrir: false,
    fragile: false,
    aRemplacer: false,
    enStock: false,
  });

  useEffect(() => {
    apiGet<{ data: Marchand[] }>('/api/marchands?statut=actif')
      .then((res) => setMarchands(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  // Le catalogue affiché dépend du marchand choisi — propre à l'admin,
  // puisque côté marchand le catalogue est implicitement le sien.
  function handleMarchandChange(marchandId: string) {
    setForm((f) => ({ ...f, marchandId, marchandiseId: '' }));
    if (!marchandId) {
      setMarchandises([]);
      return;
    }
    apiGet<{ data: Marchandise[] }>(`/api/marchandises?marchandId=${marchandId}`)
      .then((res) => setMarchandises(res.data))
      .catch(() => setMarchandises([]));
  }

  const marchandiseSelectionnee = marchandises.find((m) => m.id === form.marchandiseId);

  // Même règle de prix auto que /marchand/colis/nouveau : prix unitaire ×
  // quantité, recalculé à chaque changement, mais toujours modifiable ensuite.
  useEffect(() => {
    if (!marchandiseSelectionnee) {
      setPrixAuto(false);
      return;
    }
    const qte = Number(form.quantite) || 1;
    const total = Number(marchandiseSelectionnee.prix) * qte;
    setForm((f) => ({ ...f, montantCod: total.toFixed(2) }));
    setPrixAuto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.marchandiseId, form.quantite]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/api/commandes', {
        ...form,
        montantCod: Number(form.montantCod),
        quantite: Number(form.quantite) || 1,
        marchandiseId: form.marchandiseId || undefined,
        colisARemplacerCode: form.colisARemplacerCode || undefined,
      });
      router.push('/admin/commandes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Nouveau colis</h1>

      <form
        onSubmit={handleCreate}
        className="grid max-w-2xl grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.02]"
      >
        <SectionTitle>Marchand</SectionTitle>
        <Field label="Marchand *" className="col-span-2">
          <select
            className="input-basic"
            value={form.marchandId}
            onChange={(e) => handleMarchandChange(e.target.value)}
            required
          >
            <option value="">Choisir un marchand…</option>
            {marchands.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nomBoutique}
              </option>
            ))}
          </select>
        </Field>

        <SectionTitle>Destinataire</SectionTitle>
        <Field label="Destinataire *" className="col-span-2">
          <input
            className="input-basic"
            value={form.clientNom}
            onChange={(e) => setForm({ ...form, clientNom: e.target.value })}
            required
          />
        </Field>
        <Field label="Téléphone *">
          <input
            className="input-basic"
            value={form.clientTelephone}
            onChange={(e) => setForm({ ...form, clientTelephone: e.target.value })}
            required
          />
        </Field>
        <Field label="Ville *">
          <input
            className="input-basic"
            value={form.ville}
            onChange={(e) => setForm({ ...form, ville: e.target.value })}
            required
          />
        </Field>
        <Field label="Adresse *" className="col-span-2">
          <input
            className="input-basic"
            value={form.adresse}
            onChange={(e) => setForm({ ...form, adresse: e.target.value })}
            required
          />
        </Field>

        <SectionTitle>Colis</SectionTitle>
        <Field
          label="Marchandise"
          hint={
            !form.marchandId
              ? 'Choisissez un marchand pour voir son catalogue'
              : marchandises.length === 0
                ? 'Catalogue vide pour ce marchand'
                : marchandiseSelectionnee
                  ? `Prix catalogue : ${marchandiseSelectionnee.prix} DH / unité`
                  : 'Facultatif — pré-remplit le prix ci-dessous'
          }
        >
          <select
            className="input-basic"
            value={form.marchandiseId}
            onChange={(e) => setForm({ ...form, marchandiseId: e.target.value })}
            disabled={!form.marchandId}
          >
            <option value="">Aucune…</option>
            {marchandises.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom} — {m.prix} DH (stock : {m.qteStock})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantité">
          <input
            className="input-basic"
            type="number"
            min="1"
            value={form.quantite}
            onChange={(e) => setForm({ ...form, quantite: e.target.value })}
          />
        </Field>

        <Field label="Prix (DH) *" hint={prixAuto ? 'Calculé (prix × quantité) — modifiable' : 'Saisie manuelle'}>
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
              required
            />
            {prixAuto && (
              <Sparkles
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-brand"
                aria-label="Calculé automatiquement"
              />
            )}
          </div>
        </Field>
        <Field label="Description produit" hint="Si le produit n'est pas encore au catalogue du marchand">
          <input
            className="input-basic"
            value={form.produitDescription}
            onChange={(e) => setForm({ ...form, produitDescription: e.target.value })}
          />
        </Field>

        <Field label="Colis à remplacer" hint="Code de suivi, si échange" className="col-span-2">
          <input
            className="input-basic"
            value={form.colisARemplacerCode}
            onChange={(e) => setForm({ ...form, colisARemplacerCode: e.target.value })}
          />
        </Field>

        <Field label="Commentaire" className="col-span-2">
          <textarea
            className="input-basic"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <div className="col-span-2 flex flex-wrap gap-4 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={form.ouvrir}
              onChange={(e) => setForm({ ...form, ouvrir: e.target.checked })}
            />
            Ouvrir (vérification à la livraison)
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
              onChange={(e) => setForm({ ...form, enStock: e.target.checked })}
            />
            En stock (entrepôt)
          </label>
        </div>

        <p className="col-span-2 -mt-1 text-xs opacity-50">* Champs obligatoires</p>

        {error && <p className="col-span-2 text-sm font-medium text-red-600">{error}</p>}

        <button type="submit" disabled={submitting || !marchands.length} className="btn-primary col-span-2 flex items-center justify-center gap-2">
          <PackagePlus className="h-4 w-4" />
          {submitting ? 'Création…' : 'Créer le colis'}
        </button>
      </form>
    </div>
  );
}
