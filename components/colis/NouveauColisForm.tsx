'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Info, PackagePlus, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { ProduitSelect } from '@/components/ProduitSelect';
import { Affix, Field, FormSection, QuantiteInput } from '@/components/form/Field';
import type { Marchand, Marchandise } from '@/lib/types';

// Formulaire de création de colis, partagé entre l'admin et le marchand.
//
// Organisation (identique des deux côtés) : à gauche des sections numérotées
// qui suivent l'ordre de la saisie réelle — qui vend, à qui on livre, quoi —,
// à droite un récapitulatif collant qui totalise le montant à encaisser et
// annonce ce qu'il reste à remplir avant de pouvoir créer.
//
// Seule la première section change : l'admin choisit le marchand (le catalogue
// et le stock en dépendent), alors que côté marchand il est implicite.

type Mode = 'admin' | 'marchand';

/* ── récapitulatif ──────────────────────────────────────── */

function RecapRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-black/45 dark:text-white/45">{label}</span>
      <span
        className={`min-w-0 truncate text-right ${
          value === '—' ? 'text-black/30 dark:text-white/30' : strong ? 'font-semibold' : 'font-medium'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/* ── formulaire ─────────────────────────────────────────── */

const EMPTY = {
  marchandId: '',
  clientNom: '',
  clientTelephone: '',
  marchandiseId: '',
  quantite: '1',
  ville: '',
  adresse: '',
  montantCod: '',
  produitDescription: '',
  produitId: '',
  notes: '',
  colisARemplacerCode: '',
  ouvrir: false,
  fragile: false,
  aRemplacer: false,
  enStock: false,
};

export function NouveauColisForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const estAdmin = mode === 'admin';

  const [marchands, setMarchands] = useState<Marchand[]>([]);
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prixAuto, setPrixAuto] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (estAdmin) {
      apiGet<{ data: Marchand[] }>('/api/marchands?statut=actif')
        .then((res) => setMarchands(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
    } else {
      // Côté marchand le catalogue est le sien : l'API le déduit de la session.
      apiGet<{ data: Marchandise[] }>('/api/marchandises')
        .then((res) => setMarchandises(res.data))
        .catch(() => {});
    }
  }, [estAdmin]);

  // Le catalogue affiché dépend du marchand choisi — propre à l'admin.
  function handleMarchandChange(marchandId: string) {
    setForm((f) => ({ ...f, marchandId, marchandiseId: '', produitId: '' }));
    if (!marchandId) {
      setMarchandises([]);
      return;
    }
    apiGet<{ data: Marchandise[] }>(`/api/marchandises?marchandId=${marchandId}`)
      .then((res) => setMarchandises(res.data))
      .catch(() => setMarchandises([]));
  }

  const marchandiseSelectionnee = marchandises.find((m) => m.id === form.marchandiseId);

  // RG prix : si une marchandise du catalogue est choisie, le prix (montant
  // COD) est recalculé à chaque changement de marchandise ou de quantité
  // (prix unitaire × quantité), mais reste modifiable manuellement ensuite.
  useEffect(() => {
    queueMicrotask(() => {
      if (!marchandiseSelectionnee) {
        setPrixAuto(false);
        return;
      }
      const qte = Number(form.quantite) || 1;
      const total = Number(marchandiseSelectionnee.prix) * qte;
      setForm((f) => ({ ...f, montantCod: total.toFixed(2) }));
      setPrixAuto(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.marchandiseId, form.quantite]);

  // Compteur du récapitulatif : ce qu'il reste à remplir avant de pouvoir créer.
  const manquants = useMemo(() => {
    const requis: (keyof typeof EMPTY)[] = estAdmin
      ? ['marchandId', 'clientNom', 'clientTelephone', 'ville', 'adresse', 'montantCod']
      : ['clientNom', 'clientTelephone', 'ville', 'adresse', 'montantCod'];
    return requis.filter((k) => !String(form[k]).trim()).length;
  }, [form, estAdmin]);

  const montant = useMemo(
    () => (Number(form.montantCod) || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2 }),
    [form.montantCod],
  );

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
        produitId: form.produitId || undefined,
        colisARemplacerCode: form.colisARemplacerCode || undefined,
      });
      router.push(estAdmin ? '/admin/commandes' : '/marchand/colis');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  const catalogueHint =
    estAdmin && !form.marchandId
      ? 'Choisissez un marchand pour voir son catalogue'
      : marchandiseSelectionnee
        ? `Prix catalogue : ${marchandiseSelectionnee.prix} DH / unité`
        : marchandises.length === 0
          ? estAdmin
            ? 'Catalogue vide pour ce marchand'
            : undefined
          : 'Facultatif — pré-remplit le prix ci-dessous';

  const marchandNom = marchands.find((m) => m.id === form.marchandId)?.nomBoutique;
  let etape = 0;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      {/* ── colonne de saisie ── */}
      <form id="nouveau-colis" onSubmit={handleCreate} className="flex min-w-0 flex-col gap-4">
        {estAdmin && (
          <FormSection step={++etape} title="Marchand">
            <div className="max-w-md">
              <Field label="Marchand" required hint="Le catalogue et les tarifs dépendent du marchand choisi.">
                <select
                  className="input-basic w-full"
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
            </div>
          </FormSection>
        )}

        <FormSection step={++etape} title="Destinataire">
          <div className="form-grid">
            <Field label="Nom complet" required className="sm:col-span-2">
              <input
                className="input-basic w-full"
                placeholder="Ex. Youssef El Amrani"
                value={form.clientNom}
                onChange={(e) => set('clientNom', e.target.value)}
                required
              />
            </Field>
            <Field label="Téléphone" required>
              <input
                className="input-basic w-full"
                type="tel"
                placeholder="06 12 34 56 78"
                value={form.clientTelephone}
                onChange={(e) => set('clientTelephone', e.target.value)}
                required
              />
            </Field>
            <Field label="Ville" required>
              <input
                className="input-basic w-full"
                placeholder="Ex. Casablanca"
                value={form.ville}
                onChange={(e) => set('ville', e.target.value)}
                required
              />
            </Field>
            <Field label="Adresse" required className="sm:col-span-2">
              <textarea
                className="input-basic min-h-0 w-full"
                rows={2}
                placeholder="Rue, quartier, repère de livraison"
                value={form.adresse}
                onChange={(e) => set('adresse', e.target.value)}
                required
              />
            </Field>
          </div>
        </FormSection>

        <FormSection step={++etape} title="Colis">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,2fr)_140px]">
            <Field label="Marchandise" hint={catalogueHint}>
              <select
                className="input-basic w-full"
                value={form.marchandiseId}
                onChange={(e) => set('marchandiseId', e.target.value)}
                disabled={estAdmin && !form.marchandId}
              >
                <option value="">Aucune…</option>
                {marchandises.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom} — {m.prix} DH (stock : {m.qteStock})
                  </option>
                ))}
              </select>
              {!estAdmin && marchandises.length === 0 && (
                <span className="text-xs text-black/45 dark:text-white/45">
                  Catalogue vide —{' '}
                  <Link href="/marchand/colis/marchandises" className="underline">
                    ajoutez une marchandise
                  </Link>
                  .
                </span>
              )}
            </Field>
            <Field label="Quantité">
              <QuantiteInput value={form.quantite} onChange={(v) => set('quantite', v)} />
            </Field>
          </div>

          <div className="form-grid items-start">
            <Field label="Prix" required hint={prixAuto ? 'Calculé (prix × quantité) — modifiable' : 'Saisie manuelle'}>
              <Affix suffix="DH">
                <input
                  className="input-bare"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={form.montantCod}
                  onChange={(e) => {
                    set('montantCod', e.target.value);
                    setPrixAuto(false);
                  }}
                  required
                />
                {prixAuto && (
                  <Sparkles
                    className="pointer-events-none my-auto mr-1 h-4 w-4 shrink-0 text-brand"
                    aria-label="Calculé automatiquement"
                  />
                )}
              </Affix>
            </Field>
            <Field
              label="Description produit"
              optional
              hint={`Si le produit n'est pas encore au catalogue${estAdmin ? ' du marchand' : ''}`}
            >
              <input
                className="input-basic w-full"
                placeholder="Ex. Coffret 2 flacons 50 ml"
                value={form.produitDescription}
                onChange={(e) => set('produitDescription', e.target.value)}
              />
            </Field>
          </div>

          {/* Traitement : des bascules qui ne changent pas la saisie mais le
              comportement de la tournée ou du circuit interne. */}
          <div className="form-divider flex flex-col gap-3">
            <span className="form-subtitle">Traitement</span>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <label className="check-row">
                <input
                  type="checkbox"
                  className="check-basic"
                  checked={form.ouvrir}
                  onChange={(e) => set('ouvrir', e.target.checked)}
                />
                Ouvrir (vérification à la livraison)
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  className="check-basic"
                  checked={form.fragile}
                  onChange={(e) => set('fragile', e.target.checked)}
                />
                Fragile
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  className="check-basic"
                  checked={form.enStock}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      enStock: e.target.checked,
                      produitId: e.target.checked ? f.produitId : '',
                    }))
                  }
                />
                En stock (entrepôt)
              </label>
            </div>

            {form.enStock && (
              <Field
                label="Produit du stock"
                hint={
                  estAdmin && !form.marchandId
                    ? 'Choisissez un marchand pour voir son stock'
                    : 'Recherche par nom ou référence — pré-remplit la description'
                }
              >
                <ProduitSelect
                  marchandId={estAdmin ? form.marchandId : undefined}
                  value={form.produitId}
                  disabled={estAdmin && !form.marchandId}
                  disabledHint="Choisissez un marchand…"
                  onSelect={(produit) =>
                    setForm((f) => ({
                      ...f,
                      produitId: produit?.id ?? '',
                      produitDescription: produit ? produit.nom : f.produitDescription,
                    }))
                  }
                />
              </Field>
            )}
          </div>

          {/* Échange : la bascule pilote la tournée (récupérer l'ancien colis),
              le code de suivi ne fait que relier les deux commandes — deux
              champs distincts, réunis ici sous un même bloc. */}
          <div className="form-divider flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="check-basic mt-0.5"
                checked={form.aRemplacer}
                onChange={(e) => set('aRemplacer', e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Ce colis en remplace un autre (échange)</span>
                <span className="text-xs text-black/45 dark:text-white/45">
                  Le livreur récupère l&apos;ancien colis chez le client et livre celui-ci à la place.
                </span>
              </span>
            </label>
            <div className="max-w-sm pl-7">
              <Field label="Colis à remplacer" optional hint="N° de suivi de l&apos;ancien colis">
                <input
                  className="input-basic w-full"
                  placeholder="N° de suivi"
                  value={form.colisARemplacerCode}
                  onChange={(e) => set('colisARemplacerCode', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="form-divider">
            <Field label="Commentaire" optional>
              <textarea
                className="input-basic min-h-0 w-full"
                rows={2}
                placeholder="Instruction pour le livreur…"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </div>
        </FormSection>
      </form>

      {/* ── récapitulatif ── */}
      <aside className="flex flex-col gap-4 xl:sticky xl:top-6">
        <div className="form-section">
          <h3 className="form-subtitle">Récapitulatif</h3>
          <div className="flex flex-col gap-2.5 text-sm">
            {estAdmin && <RecapRow label="Marchand" value={marchandNom || '—'} />}
            <RecapRow label="Destinataire" value={form.clientNom || '—'} />
            <RecapRow label="Ville" value={form.ville || '—'} />
            <RecapRow label="Quantité" value={String(Number(form.quantite) || 1)} strong />
          </div>
          <div className="form-divider flex items-baseline justify-between gap-3 pt-3">
            <span className="text-sm text-black/55 dark:text-white/55">Montant à encaisser</span>
            <span className="text-xl font-black tracking-tight">{montant} DH</span>
          </div>
        </div>

        {manquants > 0 && (
          <div className="flex flex-col gap-2 rounded-2xl border border-brand/25 bg-brand/[0.09] p-4 dark:border-brand/15 dark:bg-brand/[0.07]">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0 text-brand-ink" />
              <span className="text-xs font-bold text-brand-ink">
                {manquants} champ{manquants > 1 ? 's' : ''} restant{manquants > 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-black/60 dark:text-white/60">
              {estAdmin ? 'Marchand, destinataire' : 'Destinataire'}, téléphone, ville, adresse et prix sont requis
              avant la création.
            </p>
          </div>
        )}

        {error && (
          <p className="form-error rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          form="nouveau-colis"
          disabled={submitting || (estAdmin && !marchands.length)}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <PackagePlus className="h-4 w-4" />
          {submitting ? 'Création…' : 'Créer le colis'}
        </button>

        <p className="text-xs text-black/40 dark:text-white/40">
          <span className="text-red-600">*</span> Champs obligatoires
        </p>
      </aside>
    </div>
  );
}
