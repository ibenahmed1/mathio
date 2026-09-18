'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, Printer, Search, Tags, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { Button } from '@/components/admin/Button';
import type { Commande } from '@/lib/types';
import type { BonDeLivraisonGenere } from '@/lib/bons-livraison';

// § /admin/bon-livraison : pendant back-office de l'écran marchand
// « Ajouter un bon de livraison ». Sert les dépôts que le marchand n'a pas
// déclarés lui-même — remise au comptoir, saisie rattrapée après coup.
//
// Différence avec l'écran marchand, qui ne voit que sa propre boutique : ici
// la sélection peut couvrir plusieurs marchands, et POST /api/bons-livraison
// génère alors un bon par marchand représenté. Même mécanique que
// /admin/stock/prets pour les bons de préparation.
export default function AdminBonLivraisonCreerPage() {
  const [colis, setColis] = useState<Commande[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [villeFiltre, setVilleFiltre] = useState('');
  const [marchandFiltre, setMarchandFiltre] = useState('');
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bonsGeneres, setBonsGeneres] = useState<BonDeLivraisonGenere[] | null>(null);

  async function load() {
    setChargement(true);
    setError(null);
    try {
      // Mêmes critères d'éligibilité que le `where` de creerBonsDeLivraison :
      // l'écran ne doit jamais proposer un colis que l'API refusera.
      const res = await apiGet<{ data: Commande[] }>(
        '/api/commandes?statut=nouveau_colis&enStock=false&sansBonLivraison=true&pageSize=100'
      );
      setColis(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  const villes = useMemo(() => Array.from(new Set(colis.map((c) => c.ville))).sort(), [colis]);

  const marchands = useMemo(
    () => Array.from(new Set(colis.map((c) => c.marchand?.nomBoutique).filter((n): n is string => !!n))).sort(),
    [colis]
  );

  const filtres = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colis.filter((c) => {
      const matchVille = !villeFiltre || c.ville === villeFiltre;
      const matchMarchand = !marchandFiltre || c.marchand?.nomBoutique === marchandFiltre;
      const matchSearch = !q || c.codeSuivi.toLowerCase().includes(q) || c.clientNom.toLowerCase().includes(q);
      return matchVille && matchMarchand && matchSearch;
    });
  }, [colis, search, villeFiltre, marchandFiltre]);

  const tousSelectionnes = filtres.length > 0 && filtres.every((c) => selected.has(c.id));

  // Ne porte que sur les lignes VISIBLES : cocher « tout » sous un filtre ne
  // doit pas embarquer les colis que l'utilisateur ne voit pas.
  function toggleTout() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (tousSelectionnes) filtres.forEach((c) => next.delete(c.id));
      else filtres.forEach((c) => next.add(c.id));
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

  const selection = useMemo(() => colis.filter((c) => selected.has(c.id)), [colis, selected]);
  const totalCod = selection.reduce((somme, c) => somme + Number(c.montantCod), 0);
  const nbMarchands = new Set(selection.map((c) => c.marchandId)).size;

  async function genererBonsLivraison() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: BonDeLivraisonGenere[] }>('/api/bons-livraison', {
        colisIds: Array.from(selected),
      });
      setBonsGeneres(res.data);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Ajouter un bon de livraison</h1>
        <Link href="/admin/bon-livraison" className="btn-outline">
          Voir les bons générés
        </Link>
      </div>

      <p className="text-sm opacity-70">
        Colis au statut « nouveau colis » pas encore rattachés à un bon. Sélectionnez les colis à regrouper : un bon de
        livraison est généré par marchand représenté dans la sélection, et ces colis passent en « attente de
        ramassage ».
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
        <select className="input-basic w-fit max-w-full" value={marchandFiltre} onChange={(e) => setMarchandFiltre(e.target.value)}>
          <option value="">Tous les marchands</option>
          {marchands.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select className="input-basic w-fit max-w-full" value={villeFiltre} onChange={(e) => setVilleFiltre(e.target.value)}>
          <option value="">Toutes les villes</option>
          {villes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="check-basic"
                    checked={tousSelectionnes}
                    onChange={toggleTout}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Code suivi</th>
                <th>Marchand</th>
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
                      className="check-basic"
                      checked={selected.has(c.id)}
                      onChange={() => toggleUn(c.id)}
                      aria-label={`Sélectionner ${c.codeSuivi}`}
                    />
                  </td>
                  <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                  <td>{c.marchand?.nomBoutique ?? '—'}</td>
                  <td>{c.clientNom}</td>
                  <td>{c.ville}</td>
                  <td>{Number(c.montantCod).toFixed(2)} DH</td>
                  <td className="whitespace-nowrap text-xs opacity-70">
                    {new Date(c.dateCreation).toLocaleDateString('fr-FR')}
                  </td>
                </tr>
              ))}
              {!chargement && filtres.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <PackageCheck className="h-8 w-8 opacity-40" />
                      <p className="font-medium">
                        {colis.length === 0
                          ? 'Aucun colis à regrouper pour le moment'
                          : 'Aucun colis ne correspond à ces filtres'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-black/10 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">
            {selected.size > 0
              ? `${selected.size} colis sélectionné${selected.size > 1 ? 's' : ''} — Total COD : ${totalCod.toFixed(2)} DH — ${nbMarchands > 1 ? `${nbMarchands} bons seront générés` : '1 bon sera généré'}`
              : 'Sélectionnez au moins un colis pour continuer'}
          </p>
          <Button
            onClick={genererBonsLivraison}
            disabled={busy || selected.size === 0}
            icon={<PackageCheck className="h-4 w-4" />}
          >
            {busy ? 'Génération…' : 'Générer le bon de livraison'}
          </Button>
        </div>
      </div>

      {bonsGeneres && <ModalBonsGeneres bons={bonsGeneres} onFermer={() => setBonsGeneres(null)} />}
    </div>
  );
}

function ModalBonsGeneres({ bons, onFermer }: { bons: BonDeLivraisonGenere[]; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-black">
        <div className="flex items-start justify-between">
          <p className="text-lg font-bold">
            {bons.length} bon{bons.length > 1 ? 's' : ''} de livraison généré{bons.length > 1 ? 's' : ''}
          </p>
          <button onClick={onFermer} className="rounded p-1 opacity-60 hover:opacity-100 pointer-coarse:-m-2 pointer-coarse:p-3" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {bons.map((b) => (
            <div key={b.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono font-semibold">{b.numero}</span>
                <span className="opacity-60">
                  {b.nbColis} colis — {Number(b.montantTotalCod).toFixed(2)} DH
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/bons-livraison/${b.id}?format=a4`}
                  target="_blank"
                  className="btn-outline flex items-center gap-2 text-xs"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Bon A4
                </Link>
                <Link
                  href={`/bons-livraison/${b.id}?format=etiquettes`}
                  target="_blank"
                  className="btn-outline flex items-center gap-2 text-xs"
                >
                  <Tags className="h-3.5 w-3.5" />
                  Étiquettes
                </Link>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onFermer}
          className="mt-4 w-full text-center text-sm font-semibold opacity-60 hover:opacity-100 pointer-coarse:min-h-10"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
