'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Plus, Send, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonEnvoi, Commande } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';

interface Destination {
  id: string;
  nom: string;
  nbColisEligibles: number;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

// § Étapes 1-3 de la création d'un Bon d'Envoi (/admin/bon-envoi/creer) :
// 1) choix du hub de destination (compteur de colis prêts), 2) badge de
// confirmation, 3) constitution du panier de colis (ajout manuel '+' ou scan
// code-barres/QR) — la création réelle (POST /api/bons-envoi) ne se fait
// qu'au clic final, qui revalide tout côté serveur.
export default function CreerBonEnvoiPage() {
  const router = useRouter();

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(true);
  const [hubDestinationId, setHubArriveeId] = useState('');

  const [eligibles, setEligibles] = useState<Commande[]>([]);
  const [loadingEligibles, setLoadingEligibles] = useState(false);
  const [selectionnes, setSelectionnes] = useState<Map<string, Commande>>(new Map());

  const [scanOuvert, setScanOuvert] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: Destination[] }>('/api/bons-envoi/destinations')
      .then((res) => setDestinations(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoadingDestinations(false));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectionnes(new Map());
      setToast(null);
      if (!hubDestinationId) {
        setEligibles([]);
        return;
      }
      setLoadingEligibles(true);
      apiGet<{ data: Commande[] }>(`/api/bons-envoi/colis-eligibles?hubDestinationId=${encodeURIComponent(hubDestinationId)}`)
        .then((res) => setEligibles(res.data))
        .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
        .finally(() => setLoadingEligibles(false));
    });
  }, [hubDestinationId]);

  const destination = useMemo(() => destinations.find((d) => d.id === hubDestinationId) ?? null, [destinations, hubDestinationId]);

  function toggleColis(commande: Commande) {
    setSelectionnes((prev) => {
      const next = new Map(prev);
      if (next.has(commande.id)) {
        next.delete(commande.id);
      } else {
        next.set(commande.id, commande);
      }
      return next;
    });
  }

  const handleScan = useCallback(
    async (raw: string) => {
      if (scanning || !hubDestinationId) return;
      setScanning(true);
      setToast(null);
      try {
        const body: Record<string, unknown> = raw.includes('.') ? { qrPayload: raw, hubDestinationId } : { codeSuivi: raw, hubDestinationId };
        const commande = await apiPost<Commande>('/api/bons-envoi/verifier-colis', body);
        setSelectionnes((prev) => new Map(prev).set(commande.id, commande));
        setToast({ type: 'success', text: `Colis ${commande.codeSuivi} ajouté au bon.` });
      } catch (err) {
        setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
      } finally {
        setScanning(false);
      }
    },
    [scanning, hubDestinationId]
  );

  async function handleCreer() {
    if (!hubDestinationId || selectionnes.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const bon = await apiPost<BonEnvoi>('/api/bons-envoi', {
        hubDestinationId,
        colisIds: Array.from(selectionnes.keys()),
      });
      router.push(`/admin/bon-envoi/${bon.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/bon-envoi" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour
        </Link>
      </div>

      <h1 className="page-title">Nouveau Bon d&apos;Envoi</h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {/* Étape 1 : destination */}
      <div className="card-tint-strong flex flex-col gap-2 p-4">
        <label className="text-sm font-bold uppercase tracking-wide opacity-70">1. Hub de destination</label>
        <select
          className="input-basic"
          value={hubDestinationId}
          onChange={(e) => setHubArriveeId(e.target.value)}
          disabled={loadingDestinations}
        >
          <option value="">
            {loadingDestinations ? 'Chargement…' : 'Sélectionner une destination'}
          </option>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nom} ({d.nbColisEligibles} colis prêts)
            </option>
          ))}
        </select>

        {/* Étape 2 : badge de confirmation */}
        {destination && (
          <p className="badge w-fit bg-brand text-brand-foreground">
            Cette destination a {destination.nbColisEligibles} colis prêts au transit
          </p>
        )}
      </div>

      {/* Étape 3 : constitution du panier */}
      {hubDestinationId && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
              3. Colis à inclure ({selectionnes.size} sélectionné{selectionnes.size > 1 ? 's' : ''})
            </h2>
            <button
              onClick={() => setScanOuvert((v) => !v)}
              className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              {scanOuvert ? 'Fermer le scan' : 'CLIC ICI AVANT LE SCAN'}
            </button>
          </div>

          {toast && (
            <div
              className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
                toast.type === 'success'
                  ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                  : 'bg-red-500/15 text-red-700 dark:text-red-400'
              }`}
            >
              {toast.text}
            </div>
          )}

          <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
            {scanOuvert && (
              <div className="min-w-0 lg:sticky lg:top-20">
                <QrScanner active={scanOuvert} onScan={handleScan} disabled={scanning} />
              </div>
            )}

            <div className="min-w-0 overflow-x-auto">
              {loadingEligibles ? (
                <p className="py-4 text-center opacity-60">Chargement des colis éligibles…</p>
              ) : (
                <table className="table-basic min-w-[640px]">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Code</th>
                      <th>Marchand</th>
                      <th>Ville</th>
                      <th>Statut</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibles.map((c) => {
                      const inclus = selectionnes.has(c.id);
                      return (
                        <tr key={c.id} className={inclus ? 'bg-brand/10' : undefined}>
                          <td></td>
                          <td className="font-mono">{c.codeSuivi}</td>
                          <td>{c.marchand?.nomBoutique ?? '—'}</td>
                          <td>{c.ville}</td>
                          <td className="whitespace-nowrap text-xs opacity-70">
                            {c.statut === 'recu_au_hub' ? 'Reçu au Hub' : 'Ramassé (stock)'}
                          </td>
                          <td>
                            <button
                              onClick={() => toggleColis(c)}
                              className={inclus ? 'btn-outline flex items-center gap-1 px-2 py-1 text-xs' : 'btn-primary flex items-center gap-1 px-2 py-1 text-xs'}
                            >
                              {inclus ? (
                                <>
                                  <X className="h-3.5 w-3.5" /> Retirer
                                </>
                              ) : (
                                <>
                                  <Plus className="h-3.5 w-3.5" /> Ajouter
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {eligibles.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-4 text-center opacity-60">
                          Aucun colis éligible pour cette destination pour le moment.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleCreer}
              disabled={selectionnes.size === 0 || creating}
              className="btn-primary flex items-center gap-2 px-5 py-2.5"
            >
              <Send className="h-4 w-4" />
              {creating ? 'Création…' : `Créer le Bon d'Envoi (${selectionnes.size} colis)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
