'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ImagePlus } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import type { Produit } from '@/lib/types';
import { LigneStockRow, type LigneStock } from './LigneStockRow';

export default function ModifierProduitPage() {
  const params = useParams<{ id: string }>();
  const [produit, setProduit] = useState<Produit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const [nom, setNom] = useState('');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [changementStatut, setChangementStatut] = useState(false);

  async function load() {
    try {
      const data = await apiGet<Produit>(`/api/produits/${params.id}`);
      setProduit(data);
      setNom(data.nom);
      setNote(data.note ?? '');
      setPhotoUrl(data.photoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function enregistrer() {
    setError(null);
    setEnregistrement(true);
    try {
      await apiPatch(`/api/produits/${params.id}`, { nom, note: note.trim() || null, photoUrl });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnregistrement(false);
    }
  }

  // Le statut est un verrou : passer sur "Reçu" déverrouille la saisie des
  // quantités dans le tableau ci-dessous (voir LigneStockRow), pas l'inverse —
  // ce n'est jamais déduit des quantités elles-mêmes.
  async function changerStatutReception(statutReception: Produit['statutReception']) {
    setError(null);
    setChangementStatut(true);
    try {
      await apiPatch(`/api/produits/${params.id}`, { statutReception });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChangementStatut(false);
    }
  }

  if (chargement) return <p className="text-sm opacity-60">Chargement…</p>;
  if (!produit) return <p className="text-sm text-red-600">{error ?? 'Produit introuvable'}</p>;

  const lignes: LigneStock[] =
    produit.variantesActivees && (produit.variantes?.length ?? 0) > 0
      ? produit.variantes!.map((v) => ({
          id: v.id,
          nom: v.nom,
          reference: v.reference,
          quantiteRecue: v.quantiteRecue,
          quantiteEnCours: v.quantiteEnCours,
          rayonnage: v.rayonnage,
          receptionUrl: `/api/produits/variantes/${v.id}/reception`,
          retraitUrl: `/api/produits/variantes/${v.id}/retrait`,
          rayonnageUrl: `/api/produits/variantes/${v.id}`,
        }))
      : [
          {
            id: produit.id,
            nom: produit.nom,
            reference: produit.reference,
            quantiteRecue: produit.quantiteRecue,
            quantiteEnCours: produit.quantiteEnCours,
            rayonnage: produit.rayonnage,
            receptionUrl: `/api/produits/${produit.id}/reception`,
            retraitUrl: `/api/produits/${produit.id}/retrait`,
            rayonnageUrl: `/api/produits/${produit.id}`,
          },
        ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Modifier produit — {produit.nom}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="opacity-60">{produit.marchand?.nomBoutique}</span>
            <span className="opacity-30">|</span>
            <select
              className="input-basic py-1"
              value={produit.statutReception}
              disabled={changementStatut}
              onChange={(e) => changerStatutReception(e.target.value as Produit['statutReception'])}
            >
              <option value="recu">Reçu</option>
              <option value="pas_encore_recu">Pas encore reçu</option>
            </select>
          </div>
        </div>
        <Link href="/admin/stock/inventaire" className="text-sm font-semibold opacity-60 hover:opacity-100">
          ← Retour à l&apos;inventaire
        </Link>
      </div>

      {produit.statutReception !== 'recu' && (
        <p className="text-xs opacity-60">
          Les quantités sont pré-remplies avec ce que le marchand a déclaré. Passez le statut sur « Reçu » pour
          pouvoir saisir la quantité réellement constatée en entrepôt.
        </p>
      )}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm sm:grid-cols-2 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Photo de produit</span>
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 text-center transition hover:border-brand hover:bg-brand/5 dark:border-white/15">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={produit.nom} className="h-full w-full rounded-xl object-cover" />
            ) : (
              <>
                <ImagePlus className="h-8 w-8 opacity-40" />
                <span className="text-sm opacity-60">Déposer une image ou cliquer</span>
              </>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </label>
          {photoUrl && (
            <button
              type="button"
              onClick={() => setPhotoUrl(null)}
              className="self-start text-xs font-semibold text-red-600 hover:opacity-70"
            >
              Supprimer la photo
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Nom du produit</span>
            <input className="input-basic" value={nom} onChange={(e) => setNom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Note du produit</span>
            <textarea className="input-basic" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button onClick={enregistrer} disabled={enregistrement} className="btn-primary self-start">
            {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[760px]">
            <thead>
              <tr>
                <th>#Réf.</th>
                <th>Nom</th>
                <th className="text-right">Reçu</th>
                <th>Valider réception</th>
                <th>Retirer du stock</th>
                <th>Rayonnage</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <LigneStockRow
                  key={ligne.id}
                  ligne={ligne}
                  deverouille={produit.statutReception === 'recu'}
                  onChanged={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Historique</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>Historique</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(produit.historique ?? []).map((h) => (
                <tr key={h.id}>
                  <td>{h.texte}</td>
                  <td className="text-xs opacity-60">{new Date(h.dateCreation).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
              {(produit.historique ?? []).length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-sm opacity-50">
                    Aucun historique
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Colis avec ce produit</h2>
        </div>
        <div className="empty-state">
          <p className="text-sm opacity-50">Aucune entrée correspondante trouvée</p>
        </div>
      </div>
    </div>
  );
}
