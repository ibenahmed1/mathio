'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Trash2, Plus, ImagePlus, Check, X, Loader2, PackagePlus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { genererReferenceProduit } from '@/lib/sku';
import { InventaireSubNav } from '../InventaireSubNav';

interface VarianteForm {
  nom: string;
  reference: string;
  quantite: string;
}

function slugifyReference(nom: string): string {
  return nom
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type StatutReference = 'idle' | 'verification' | 'disponible' | 'prise' | 'erreur';

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

export default function NouveauProduitPage() {
  const router = useRouter();
  const [nom, setNom] = useState('');
  const [reference, setReference] = useState('');
  const [quantite, setQuantite] = useState('0');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [variantesActivees, setVariantesActivees] = useState(false);
  const [variantes, setVariantes] = useState<VarianteForm[]>([]);
  const [statutReference, setStatutReference] = useState<StatutReference>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setReference(genererReferenceProduit());
    });
  }, []);

  // Validation dynamique de l'unicité (debounce 500ms) — isolée par marchand
  // connecté : deux marchands peuvent avoir le même SKU, un seul ne peut pas.
  useEffect(() => {
    const valeur = reference.trim();
    if (!valeur) {
      queueMicrotask(() => setStatutReference('idle'));
      return;
    }
    queueMicrotask(() => setStatutReference('verification'));
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<{ disponible: boolean }>(
          `/api/produits/verifier-reference?reference=${encodeURIComponent(valeur)}`
        );
        setStatutReference(res.disponible ? 'disponible' : 'prise');
      } catch {
        setStatutReference('erreur');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [reference]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoUrl(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.readAsDataURL(file);
  }

  function ajouterVariante() {
    setVariantes((v) => [...v, { nom: '', reference: '', quantite: '0' }]);
  }

  function retirerVariante(index: number) {
    setVariantes((v) => v.filter((_, i) => i !== index));
  }

  function modifierVariante(index: number, patch: Partial<VarianteForm>) {
    setVariantes((v) =>
      v.map((variante, i) => {
        if (i !== index) return variante;
        const next = { ...variante, ...patch };
        const referenceAuto = variante.nom ? `${reference}-${slugifyReference(variante.nom)}` : '';
        // La référence de variante suit le nom tant qu'elle n'a pas été éditée à la main.
        if (patch.nom !== undefined && (variante.reference === '' || variante.reference === referenceAuto)) {
          next.reference = next.nom ? `${reference}-${slugifyReference(next.nom)}` : '';
        }
        return next;
      })
    );
  }

  function toggleVariantes(actives: boolean) {
    setVariantesActivees(actives);
    if (actives && variantes.length === 0) {
      setVariantes([{ nom: '', reference: '', quantite: '0' }]);
    }
  }

  const quantiteTotaleVariantes = variantes.reduce((total, v) => total + (Number(v.quantite) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (statutReference === 'prise') {
      setError('Référence déjà utilisée dans votre stock');
      return;
    }
    if (variantesActivees && variantes.some((v) => !v.nom.trim() || !v.reference.trim())) {
      setError('Chaque variante doit avoir un nom et une référence');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost('/api/produits', {
        nom,
        reference: reference.trim(),
        quantiteEnCours: Number(quantite) || 0,
        note: note.trim() || undefined,
        photoUrl: photoUrl ?? undefined,
        variantesActivees,
        variantes: variantesActivees
          ? variantes.map((v) => ({ nom: v.nom.trim(), reference: v.reference.trim(), quantiteEnCours: Number(v.quantite) || 0 }))
          : undefined,
      });
      router.push('/marchand/inventaire');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Ajouter Produit</h1>

      <InventaireSubNav />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm sm:grid-cols-2 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Photo de produit</span>
            <label className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 text-center transition hover:border-brand hover:bg-brand/5 dark:border-white/15">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="Aperçu du produit" className="h-full w-full rounded-xl object-cover" />
              ) : (
                <>
                  <ImagePlus className="h-8 w-8 opacity-40" />
                  <span className="text-sm opacity-60">Déposer une image ou cliquer</span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </label>
            {photoUrl && (
              <button type="button" onClick={() => setPhotoUrl(null)} className="self-start text-xs font-semibold text-red-600 hover:opacity-70">
                Retirer la photo
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Field label="Nom du produit *">
              <input className="input-basic" value={nom} onChange={(e) => setNom(e.target.value)} required />
            </Field>

            <Field label="Réf. du produit *">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    className="input-basic w-full pr-8"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                    {statutReference === 'verification' && <Loader2 className="h-4 w-4 animate-spin opacity-50" />}
                    {statutReference === 'disponible' && <Check className="h-4 w-4 text-green-600" />}
                    {statutReference === 'prise' && <X className="h-4 w-4 text-red-600" />}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReference(genererReferenceProduit())}
                  className="btn-outline flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Générer auto
                </button>
              </div>
              {statutReference === 'prise' && <span className="text-xs font-medium text-red-600">Référence déjà utilisée dans votre stock</span>}
            </Field>

            <Field
              label="Quantité *"
              hint={
                variantesActivees
                  ? `Calculée automatiquement (${quantiteTotaleVariantes} via variantes)`
                  : "Déclarée par vous — passe en « Reçu » une fois validée par l'admin"
              }
            >
              <input
                className="input-basic"
                type="number"
                min="0"
                value={variantesActivees ? quantiteTotaleVariantes : quantite}
                onChange={(e) => setQuantite(e.target.value)}
                disabled={variantesActivees}
                required
              />
            </Field>

            <Field label="Note du produit">
              <textarea className="input-basic" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleVariantes(!variantesActivees)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              variantesActivees ? 'bg-green-600 text-white' : 'bg-black/[0.06] text-black/70 dark:bg-white/10 dark:text-white/70'
            }`}
          >
            {variantesActivees ? '✓ Variantes activées' : 'Variantes désactivées'}
          </button>
        </div>

        {variantesActivees && (
          <div className="table-card">
            <div className="overflow-x-auto">
              <table className="table-basic min-w-[560px]">
                <thead>
                  <tr>
                    <th>Nom de la variante</th>
                    <th>Référence</th>
                    <th className="text-right">Quantité</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {variantes.map((v, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          className="input-basic w-full"
                          value={v.nom}
                          onChange={(e) => modifierVariante(index, { nom: e.target.value })}
                          placeholder="Ex. Rouge"
                          required
                        />
                      </td>
                      <td>
                        <input
                          className="input-basic w-full font-mono text-xs"
                          value={v.reference}
                          onChange={(e) => modifierVariante(index, { reference: e.target.value })}
                          required
                        />
                      </td>
                      <td className="text-right">
                        <input
                          className="input-basic w-24 text-right"
                          type="number"
                          min="0"
                          value={v.quantite}
                          onChange={(e) => modifierVariante(index, { quantite: e.target.value })}
                        />
                      </td>
                      <td className="w-8">
                        <button
                          type="button"
                          onClick={() => retirerVariante(index)}
                          className="text-red-600 transition hover:opacity-70"
                          aria-label="Retirer cette variante"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={ajouterVariante}
              className="flex w-full items-center justify-center gap-2 border-t border-black/10 py-2.5 text-sm font-semibold text-green-700 transition hover:bg-green-600/10 dark:border-white/10 dark:text-green-400"
            >
              <Plus className="h-4 w-4" />
              Ajouter une variante
            </button>
          </div>
        )}

        <p className="-mt-1 text-xs opacity-50">* Champs obligatoires</p>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || statutReference === 'verification' || statutReference === 'prise'}
          className="btn-primary flex items-center justify-center gap-2 self-start"
        >
          <PackagePlus className="h-4 w-4" />
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  );
}
