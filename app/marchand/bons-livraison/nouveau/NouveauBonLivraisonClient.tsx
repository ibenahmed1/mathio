'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Printer, Tags, Truck, X, PackageCheck } from 'lucide-react';
import { creerBonDeLivraison, type BonDeLivraisonGenere } from '../actions';
import type { Commande } from '@/lib/types';

type ColisLigne = Pick<Commande, 'id' | 'codeSuivi' | 'clientNom' | 'ville' | 'montantCod' | 'dateCreation'>;

export function NouveauBonLivraisonClient({ colisInitial }: { colisInitial: ColisLigne[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [villeFiltre, setVilleFiltre] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultat, setResultat] = useState<BonDeLivraisonGenere | null>(null);
  const [isPending, startTransition] = useTransition();

  const villes = useMemo(() => Array.from(new Set(colisInitial.map((c) => c.ville))).sort(), [colisInitial]);

  const filtres = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colisInitial.filter((c) => {
      const matchVille = !villeFiltre || c.ville === villeFiltre;
      const matchSearch = !q || c.codeSuivi.toLowerCase().includes(q) || c.clientNom.toLowerCase().includes(q);
      return matchVille && matchSearch;
    });
  }, [colisInitial, search, villeFiltre]);

  const tousSelectionnes = filtres.length > 0 && filtres.every((c) => selected.has(c.id));

  const totalCod = useMemo(
    () =>
      colisInitial
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + Number(c.montantCod), 0),
    [colisInitial, selected]
  );

  function toggleTout() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (tousSelectionnes) {
        filtres.forEach((c) => next.delete(c.id));
      } else {
        filtres.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleUn(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function genererBonDeLivraison() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await creerBonDeLivraison(Array.from(selected));
        setResultat(res);
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors de la génération du bon de livraison');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Ajouter un bon de livraison</h1>
        <Link href="/marchand/bons-livraison" className="btn-outline">
          Voir les bons générés
        </Link>
      </div>

      <p className="text-sm opacity-70">
        Sélectionnez les colis en attente à regrouper dans un même bon de livraison. Une fois généré, ces colis
        passent au statut « confirmée ».
      </p>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input
            className="input-basic w-64 pl-8"
            placeholder="Code de suivi ou destinataire"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input-basic w-fit" value={villeFiltre} onChange={(e) => setVilleFiltre(e.target.value)}>
          <option value="">Toutes les villes</option>
          {villes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={tousSelectionnes}
                  onChange={toggleTout}
                  aria-label="Tout sélectionner"
                />
              </th>
              <th>Code suivi</th>
              <th>Destinataire</th>
              <th>Ville</th>
              <th>Montant COD</th>
              <th>Date de création</th>
            </tr>
          </thead>
          <tbody>
            {filtres.map((c) => (
              <tr key={c.id} className={selected.has(c.id) ? 'bg-brand/10' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleUn(c.id)}
                    aria-label={`Sélectionner ${c.codeSuivi}`}
                  />
                </td>
                <td className="font-mono">{c.codeSuivi}</td>
                <td>{c.clientNom}</td>
                <td>{c.ville}</td>
                <td>{Number(c.montantCod).toFixed(2)} DH</td>
                <td>{new Date(c.dateCreation).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
            {filtres.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center opacity-60">
                  {colisInitial.length === 0
                    ? 'Aucun colis en attente à regrouper pour le moment.'
                    : 'Aucun colis ne correspond à ces filtres.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-30 -mx-4 border-t border-black/10 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">
              {selected.size} colis sélectionné{selected.size > 1 ? 's' : ''} — Total COD : {totalCod.toFixed(2)} DH
            </p>
            <button onClick={genererBonDeLivraison} disabled={isPending} className="btn-primary flex items-center gap-2">
              <PackageCheck className="h-4 w-4" />
              {isPending ? 'Génération…' : 'Générer le Bon de Livraison & Imprimer'}
            </button>
          </div>
        </div>
      )}

      {resultat && <ModalConfirmation resultat={resultat} onFermer={() => setResultat(null)} />}
    </div>
  );
}

function ModalConfirmation({ resultat, onFermer }: { resultat: BonDeLivraisonGenere; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-black">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm opacity-60">Bon de livraison généré</p>
            <p className="text-xl font-black">{resultat.numero}</p>
          </div>
          <button onClick={onFermer} className="rounded p-1 opacity-60 hover:opacity-100" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm opacity-70">
          {resultat.nbColis} colis — Total COD : {Number(resultat.montantTotalCod).toFixed(2)} DH
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Link
            href={`/bons-livraison/${resultat.id}?format=a4`}
            target="_blank"
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Imprimer le Bon de Livraison (A4)
          </Link>
          <Link
            href={`/bons-livraison/${resultat.id}?format=etiquettes`}
            target="_blank"
            className="btn-outline flex items-center justify-center gap-2"
          >
            <Tags className="h-4 w-4" />
            Imprimer les Étiquettes Code-barres
          </Link>
          <Link
            href={`/marchand/colis/ramassage?bonLivraisonId=${resultat.id}`}
            className="btn-outline flex items-center justify-center gap-2"
          >
            <Truck className="h-4 w-4" />
            Demander un ramassage pour ce BL
          </Link>
        </div>

        <button onClick={onFermer} className="mt-4 w-full text-center text-sm font-semibold opacity-60 hover:opacity-100">
          Fermer
        </button>
      </div>
    </div>
  );
}
