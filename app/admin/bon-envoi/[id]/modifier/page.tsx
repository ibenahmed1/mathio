'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Plus, Save, X } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import type { BonEnvoi, Commande } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';

type Toast = { type: 'success' | 'error'; text: string } | null;

// § "Modifier le bon" (menu Actions, /admin/bon-envoi/[id]/modifier) : reprend
// la structure de l'étape 3 de la création (/admin/bon-envoi/creer) — liste
// des colis éligibles + ajout manuel/scan — en l'appliquant à un BE déjà
// existant (encore 'nouveau'), avec en plus le retrait de colis déjà inclus.
// Le diff (ajouterColisIds/retirerColisIds) n'est envoyé qu'au clic final,
// PATCH /api/bons-envoi/[id] revalidant tout côté serveur.
export default function ModifierBonEnvoiPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [bon, setBon] = useState<BonEnvoi | null>(null);
  const [loadingBon, setLoadingBon] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aRetirer, setARetirer] = useState<Set<string>>(new Set());

  const [eligibles, setEligibles] = useState<Commande[]>([]);
  const [loadingEligibles, setLoadingEligibles] = useState(true);
  const [aAjouter, setAAjouter] = useState<Map<string, Commande>>(new Map());

  const [scanOuvert, setScanOuvert] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<BonEnvoi>(`/api/bons-envoi/${params.id}`)
      .then((b) => {
        if (b.statut !== 'nouveau') {
          setError("Ce Bon d'Envoi a déjà été reçu, il ne peut plus être modifié.");
        }
        setBon(b);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoadingBon(false));
  }, [params.id]);

  useEffect(() => {
    if (!bon) return;
    apiGet<{ data: Commande[] }>(`/api/bons-envoi/colis-eligibles?hubDestinationId=${encodeURIComponent(bon.hubDestinationId)}`)
      .then((res) => setEligibles(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoadingEligibles(false));
  }, [bon]);

  function toggleRetirer(id: string) {
    setARetirer((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAjouter(commande: Commande) {
    setAAjouter((prev) => {
      const next = new Map(prev);
      if (next.has(commande.id)) next.delete(commande.id);
      else next.set(commande.id, commande);
      return next;
    });
  }

  const handleScan = useCallback(
    async (raw: string) => {
      if (scanning || !bon) return;
      setScanning(true);
      setToast(null);
      try {
        const body: Record<string, unknown> = raw.includes('.')
          ? { qrPayload: raw, hubDestinationId: bon.hubDestinationId }
          : { codeSuivi: raw, hubDestinationId: bon.hubDestinationId };
        const commande = await apiPost<Commande>('/api/bons-envoi/verifier-colis', body);
        setAAjouter((prev) => new Map(prev).set(commande.id, commande));
        setToast({ type: 'success', text: `Colis ${commande.codeSuivi} ajouté.` });
      } catch (err) {
        setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
      } finally {
        setScanning(false);
      }
    },
    [scanning, bon]
  );

  const aModifier = aRetirer.size > 0 || aAjouter.size > 0;

  async function handleEnregistrer() {
    if (!bon || !aModifier) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/bons-envoi/${bon.id}`, {
        ajouterColisIds: Array.from(aAjouter.keys()),
        retirerColisIds: Array.from(aRetirer),
      });
      router.push(`/admin/bon-envoi/${bon.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setSaving(false);
    }
  }

  const backLink = useMemo(() => `/admin/bon-envoi/${params.id}`, [params.id]);

  if (loadingBon) return <p className="opacity-60">Chargement…</p>;

  if (!bon) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/admin/bon-envoi" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour
        </Link>
        <p className="text-sm font-medium text-red-600">{error ?? "Bon d'envoi introuvable"}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href={backLink} className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100">
        <ChevronLeft className="h-4 w-4" />
        Retour au bon {bon.numero}
      </Link>

      <h1 className="page-title">Modifier {bon.numero}</h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {bon.statut === 'nouveau' && (
        <>
          <div>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide opacity-70">
              Colis actuellement dans ce bon ({(bon.commandes ?? []).length})
            </h2>
            <div className="overflow-x-auto">
              <table className="table-basic min-w-[560px]">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Marchand</th>
                    <th>Ville</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(bon.commandes ?? []).map((c) => {
                    const retire = aRetirer.has(c.id);
                    return (
                      <tr key={c.id} className={retire ? 'opacity-40 line-through' : undefined}>
                        <td className="font-mono">{c.codeSuivi}</td>
                        <td>{c.marchand?.nomBoutique ?? '—'}</td>
                        <td>{c.ville}</td>
                        <td>
                          <button
                            onClick={() => toggleRetirer(c.id)}
                            className={retire ? 'btn-primary flex items-center gap-1 px-2 py-1 text-xs' : 'btn-outline flex items-center gap-1 px-2 py-1 text-xs'}
                          >
                            {retire ? 'Annuler' : 'Retirer'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
                Ajouter des colis ({aAjouter.size} sélectionné{aAjouter.size > 1 ? 's' : ''})
              </h2>
              <button onClick={() => setScanOuvert((v) => !v)} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
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
                  <table className="table-basic min-w-[560px]">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Marchand</th>
                        <th>Ville</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibles.map((c) => {
                        const inclus = aAjouter.has(c.id);
                        return (
                          <tr key={c.id} className={inclus ? 'bg-brand/10' : undefined}>
                            <td className="font-mono">{c.codeSuivi}</td>
                            <td>{c.marchand?.nomBoutique ?? '—'}</td>
                            <td>{c.ville}</td>
                            <td>
                              <button
                                onClick={() => toggleAjouter(c)}
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
                          <td colSpan={4} className="py-4 text-center opacity-60">
                            Aucun autre colis éligible pour cette destination pour le moment.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleEnregistrer}
              disabled={!aModifier || saving}
              className="btn-primary flex items-center gap-2 px-5 py-2.5"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
