'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { HubRetour } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';
import { StatutBadge } from '@/components/StatutBadge';
import { Field } from '@/components/form/Field';

interface RetourAttendu {
  remiseId: string;
  commandeId: string;
  codeSuivi: string;
  clientNom: string;
  ville: string;
  marchand: string;
  statut: string;
  transporteur: string;
  codeEnvoye: string;
  retourDeclareLe: string | null;
  retourDeclareCode: string | null;
  joursDepuisDeclaration: number | null;
  enAlerte: boolean;
}

interface ListeRetours {
  delaiAlerteJours: number;
  enAlerte: number;
  data: RetourAttendu[];
}

interface ResultatReception {
  codeSuivi: string;
  clientNom: string;
  transporteur: string;
  dejaScanne: boolean;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// § /admin/bon-retour/transporteurs : les colis confiés par API (Power, Meta,
// Colivraison, EST) qui doivent nous revenir. Le transporteur peut DÉCLARER
// un retour, mais seul le scan de cet écran fait passer le colis « Retourné
// au hub » (décidé le 11/10/2026, lib/retour-transporteur.ts). Un retour
// déclaré et non reçu au-delà du délai est en alerte : à réclamer au
// transporteur, sa déclaration datée faisant preuve.
export default function RetoursTransporteursPage() {
  const [hubs, setHubs] = useState<HubRetour[]>([]);
  const [hubId, setHubId] = useState('');
  const [liste, setListe] = useState<ListeRetours | null>(null);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    apiGet<{ data: HubRetour[] }>('/api/bons-retour/zones')
      .then((res) => {
        setHubs(res.data);
        if (res.data.length === 1) setHubId(res.data[0].id);
      })
      .catch(() => {});
  }, []);

  const charger = useCallback(() => {
    apiGet<ListeRetours>(`/api/bons-retour/transporteurs${hubId ? `?hubId=${encodeURIComponent(hubId)}` : ''}`)
      .then(setListe)
      .catch((err) => setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de chargement' }));
  }, [hubId]);

  useEffect(() => {
    charger();
  }, [charger]);

  async function handleScan(raw: string) {
    if (scanning) return;
    if (!hubId) {
      setToast({ type: 'error', text: 'Sélectionnez le hub de réception avant de scanner.' });
      return;
    }
    setScanning(true);
    setToast(null);
    try {
      const body: Record<string, unknown> = raw.includes('.') ? { qrPayload: raw } : { codeSuivi: raw };
      body.hubId = hubId;
      const r = await apiPost<ResultatReception>('/api/bons-retour/transporteurs/reception', body);
      setToast({
        type: 'success',
        text: r.dejaScanne
          ? `${r.codeSuivi} était déjà reçu.`
          : `${r.codeSuivi} — ${r.clientNom} : retour ${r.transporteur} reçu, colis « Retourné au hub ».`,
      });
      charger();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
    } finally {
      setScanning(false);
    }
  }

  const delai = liste?.delaiAlerteJours ?? 3;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Retours transporteurs</h1>
        <p className="mt-1 text-sm opacity-70">
          Un retour annoncé par le transporteur ne change rien au colis : seul le scan à notre hub le fait passer
          « Retourné au hub ».
        </p>
      </div>

      {liste && liste.enAlerte > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {liste.enAlerte} retour{liste.enAlerte > 1 ? 's' : ''} déclaré{liste.enAlerte > 1 ? 's' : ''} depuis{' '}
          {delai} jours ou plus, jamais reçu{liste.enAlerte > 1 ? 's' : ''} : à réclamer au transporteur.
        </div>
      )}

      {hubs.length > 1 && (
        <Field label="Hub de réception">
          <select className="input-basic" value={hubId} onChange={(e) => setHubId(e.target.value)}>
            <option value="">Tous les hubs (choisir un hub pour scanner)</option>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.nom}
              </option>
            ))}
          </select>
        </Field>
      )}

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
        <div className="min-w-0 lg:sticky lg:top-20">
          <QrScanner active onScan={handleScan} disabled={scanning || !hubId} />
        </div>

        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide opacity-70">
            Retours attendus ({liste?.data.length ?? '—'})
          </h2>
          {liste && liste.data.length === 0 ? (
            <div className="empty-state table-card">
              <PackageCheck className="h-8 w-8" />
              <p className="font-semibold">Aucun retour en attente.</p>
            </div>
          ) : (
            <div className="table-card min-w-0 overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Transporteur</th>
                    <th>Client</th>
                    <th>Marchand</th>
                    <th>Statut</th>
                    <th>Retour déclaré</th>
                  </tr>
                </thead>
                <tbody>
                  {liste?.data.map((r) => (
                    <tr key={r.remiseId} className={r.enAlerte ? 'bg-red-500/10' : undefined}>
                      <td className="font-mono font-semibold">{r.codeSuivi}</td>
                      <td className="whitespace-nowrap">{r.transporteur}</td>
                      <td>
                        {r.clientNom}
                        <span className="block text-xs opacity-60">{r.ville}</span>
                      </td>
                      <td>{r.marchand}</td>
                      <td>
                        <StatutBadge statut={r.statut} />
                      </td>
                      <td className="whitespace-nowrap">
                        {r.retourDeclareLe ? (
                          <span className={r.enAlerte ? 'font-semibold text-red-700 dark:text-red-400' : undefined}>
                            {r.enAlerte && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                            le {formatDate(r.retourDeclareLe)} · {r.joursDepuisDeclaration} j
                            <span className="block text-xs font-normal opacity-60">{r.retourDeclareCode}</span>
                          </span>
                        ) : (
                          <span className="opacity-60">Non déclaré</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
