'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PackagePlus, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Marchandise } from '@/lib/types';

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
  return <h2 className="sm:col-span-2 mt-1 text-sm font-bold uppercase tracking-wide text-black/70 first:mt-0 dark:text-white/70">{children}</h2>;
}

export default function NouveauColisPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [prixAuto, setPrixAuto] = useState(false);
  const [form, setForm] = useState({
    clientNom: '',
    clientTelephone: '',
    marchandiseId: '',
    quantite: '1',
    ville: '',
    adresse: '',
    montantCod: '',
    notes: '',
    colisARemplacerCode: '',
    ouvrir: false,
    fragile: false,
    aRemplacer: false,
    enStock: false,
  });

  useEffect(() => {
    apiGet<{ data: Marchandise[] }>('/api/marchandises')
      .then((res) => setMarchandises(res.data))
      .catch(() => {});
  }, []);

  const marchandiseSelectionnee = marchandises.find((m) => m.id === form.marchandiseId);

  // RG prix : si une marchandise du catalogue est choisie, le prix (montant
  // COD) est recalculé automatiquement à chaque changement de marchandise ou
  // de quantité (prix unitaire × quantité). Le champ reste un input normal,
  // toujours modifiable manuellement par la suite.
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
      router.push('/marchand/colis');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Nouveau colis</h1>
        <Link href="/marchand/colis" className="text-sm font-semibold opacity-60 hover:opacity-100">
          ← Retour aux colis
        </Link>
      </div>

      <form
        onSubmit={handleCreate}
        className="grid max-w-2xl grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm sm:grid-cols-2 dark:border-white/10 dark:bg-white/[0.02]"
      >
        <SectionTitle>Destinataire</SectionTitle>
        <Field label="Destinataire *" className="sm:col-span-2">
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
        <Field label="Adresse *" className="sm:col-span-2">
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
            marchandises.length === 0
              ? undefined
              : marchandiseSelectionnee
                ? `Prix catalogue : ${marchandiseSelectionnee.prix} DH / unité`
                : 'Facultatif — pré-remplit le prix ci-dessous'
          }
        >
          <select
            className="input-basic"
            value={form.marchandiseId}
            onChange={(e) => setForm({ ...form, marchandiseId: e.target.value })}
          >
            <option value="">Aucune…</option>
            {marchandises.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom} — {m.prix} DH (stock : {m.qteStock})
              </option>
            ))}
          </select>
          {marchandises.length === 0 && (
            <span className="text-xs opacity-60">
              Catalogue vide —{' '}
              <Link href="/marchand/colis/marchandises" className="underline">
                ajoutez une marchandise
              </Link>
              .
            </span>
          )}
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

        <Field
          label="Prix (DH) *"
          hint={prixAuto ? undefined : 'Saisie manuelle'}
        >
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
          {prixAuto && <span className="text-xs opacity-50">Calculé (prix × quantité) — modifiable</span>}
        </Field>
        <Field label="Colis à remplacer" hint="Code de suivi, si échange">
          <input
            className="input-basic"
            value={form.colisARemplacerCode}
            onChange={(e) => setForm({ ...form, colisARemplacerCode: e.target.value })}
          />
        </Field>

        <Field label="Commentaire" className="sm:col-span-2">
          <textarea
            className="input-basic"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
          />
        </Field>

        <div className="sm:col-span-2 flex flex-wrap gap-4 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
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

        <p className="sm:col-span-2 -mt-1 text-xs opacity-50">* Champs obligatoires</p>

        {error && <p className="sm:col-span-2 text-sm font-medium text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary sm:col-span-2 flex items-center justify-center gap-2">
          <PackagePlus className="h-4 w-4" />
          {submitting ? 'Création…' : 'Créer le colis'}
        </button>
      </form>
    </div>
  );
}
