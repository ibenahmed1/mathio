'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';
import { StatutBadge } from '@/components/StatutBadge';
import { ChevronLeft, List, PackageCheck, RotateCcw, ScanLine } from 'lucide-react';
import { Field } from '@/components/form/Field';

interface HubAgentUser {
  id: string;
  nomComplet: string;
  role: string;
  hub?: { id: string; nom: string } | null;
}

interface HubOption {
  id: string;
  nom: string;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

// § Tournée en cours : liste de contrôle du ramasseur détecté au premier
// scan (tous ses colis "ramasse"), chargée automatiquement — pas de
// sélection manuelle. Mélange colis pas encore scannés (statut "ramasse")
// et déjà scannés cette session (statut "recu_au_hub"), distingués côté
// affichage plutôt que par un champ séparé, pour rester la source unique de
// vérité (pas de désynchronisation avec `recues`).
interface TourneeState {
  ramasseurId: string;
  ramasseurNom: string;
  colis: Commande[];
}

function formatHeure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// § /admin/scan/reception : flux de scan de l'Agent Hub — reprend le pattern
// de app/ramasseur/page.tsx (accueil/scan/liste, QrScanner, saisie manuelle
// de secours) mais rendu dans le shell admin (sidebar + barre minimale
// existantes) plutôt qu'en écran standalone, puisqu'il s'agit ici d'une page
// back-office comme une autre. Un admin sans hub de rattachement propre doit
// choisir un hub avant de scanner (dépannage/tests) ; un agent_hub scanne
// toujours pour son propre hub, résolu côté serveur.
export default function ScanReceptionHubPage() {
  const [user, setUser] = useState<HubAgentUser | null>(null);
  const [view, setView] = useState<'accueil' | 'scan' | 'liste'>('accueil');
  const [recues, setRecues] = useState<Commande[]>([]);
  const [loadingRecues, setLoadingRecues] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [hubChoisiId, setHubChoisiId] = useState('');
  const [tournee, setTournee] = useState<TourneeState | null>(null);

  useEffect(() => {
    apiGet<HubAgentUser>('/api/auth/me').then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'admin' || user.hub) return;
    apiGet<{ data: HubOption[] }>('/api/hubs')
      .then((res) => setHubs(res.data))
      .catch(() => {});
  }, [user]);

  // Retrouve "colis reçus aujourd'hui" au chargement (survit à un
  // rafraîchissement de page) — même principe que le ramasseur (dateCollecteFrom).
  useEffect(() => {
    if (!user) return;
    apiGet<{ data: Commande[] }>(
      `/api/commandes?statut=recu_au_hub&dateReceptionHubFrom=${encodeURIComponent(startOfTodayIso())}&pageSize=100`
    )
      .then((res) =>
        setRecues(
          [...res.data].sort(
            (a, b) => new Date(b.dateReceptionHub ?? 0).getTime() - new Date(a.dateReceptionHub ?? 0).getTime()
          )
        )
      )
      .catch(() => {})
      .finally(() => setLoadingRecues(false));
  }, [user]);

  const hubNom = user?.hub?.nom;
  const adminSansHub = user?.role === 'admin' && !user.hub;

  async function handleScan(raw: string) {
    if (scanning) return;
    setScanning(true);
    setToast(null);
    try {
      const body: Record<string, unknown> = raw.includes('.') ? { qrPayload: raw } : { codeSuivi: raw };
      if (adminSansHub) {
        if (!hubChoisiId) {
          setToast({ type: 'error', text: 'Sélectionnez un hub avant de scanner.' });
          setScanning(false);
          return;
        }
        body.hubId = hubChoisiId;
      }
      const commande = await apiPost<Commande>('/api/commandes/scan-reception', body);
      const note = await syncTournee(commande);
      setToast({ type: 'success', text: `Colis ${commande.codeSuivi} — ${commande.clientNom} réceptionné.${note ? ` ${note}` : ''}` });
      setRecues((prev) => [commande, ...prev.filter((c) => c.id !== commande.id)]);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
    } finally {
      setScanning(false);
    }
  }

  // Dès le premier scan d'un colis "ramasse" sans tournée active : identifie
  // son ramasseur et charge automatiquement tous ses autres colis "ramasse"
  // (pas de sélection manuelle). Un scan suivant qui correspond à la tournée
  // active met juste à jour sa ligne (verte) ; un scan d'un autre ramasseur
  // pendant une tournée active est quand même réceptionné mais laissé hors
  // checklist, pour ne pas mélanger deux tournées à l'écran.
  async function syncTournee(commande: Commande): Promise<string | undefined> {
    if (!tournee) {
      if (!commande.ramasseurId) return undefined;
      try {
        const res = await apiGet<{ data: Commande[] }>(
          `/api/commandes/scan-reception?ramasseurId=${encodeURIComponent(commande.ramasseurId)}`
        );
        setTournee({
          ramasseurId: commande.ramasseurId,
          ramasseurNom: commande.ramasseur?.nomComplet ?? res.data[0]?.ramasseur?.nomComplet ?? 'Ramasseur',
          colis: [commande, ...res.data],
        });
      } catch {
        // Pas bloquant : le scan a réussi même si le chargement de la checklist échoue.
      }
      return undefined;
    }

    if (commande.ramasseurId !== tournee.ramasseurId) {
      return `(hors tournée de ${tournee.ramasseurNom} en cours)`;
    }

    setTournee((prev) =>
      prev
        ? {
            ...prev,
            colis: prev.colis.some((c) => c.id === commande.id)
              ? prev.colis.map((c) => (c.id === commande.id ? commande : c))
              : [commande, ...prev.colis],
          }
        : prev
    );
    return undefined;
  }

  return (
    <div className="flex flex-col gap-4">
      {view === 'accueil' && (
        <div className="mx-auto flex max-w-xl flex-col gap-6 pt-4">
          <div className="text-center">
            <h1 className="page-title">Réception au hub</h1>
            <p className="mt-1 text-sm opacity-70">
              {user ? `Bonjour ${user.nomComplet.split(' ')[0]}` : 'Bonjour'}
              {hubNom ? ` — ${hubNom}` : ''}
            </p>
          </div>

          <div className="card-tint-strong flex flex-col items-center gap-1 py-6 text-center">
            <span className="text-xs font-bold uppercase tracking-wide opacity-80">Colis reçus aujourd&apos;hui</span>
            <span className="text-5xl font-black">{loadingRecues ? '—' : recues.length}</span>
          </div>

          <button
            onClick={() => setView('scan')}
            className="btn-primary flex items-center justify-center gap-2 py-4 text-base"
          >
            <ScanLine className="h-5 w-5" />
            Commencer le scan
          </button>

          {recues.length > 0 && (
            <button
              onClick={() => setView('liste')}
              className="flex items-center justify-center gap-2 rounded-xl border border-black/10 py-3 text-sm font-semibold opacity-80 transition hover:opacity-100 dark:border-white/10"
            >
              <List className="h-4 w-4" />
              Voir les colis reçus ({recues.length})
            </button>
          )}

          <p className="text-center text-xs opacity-60">
            Scannez le QR code (ou saisissez le code) de chaque colis déposé au quai : son statut passera
            automatiquement de « Ramassé » à « Reçu au Hub ».
          </p>
        </div>
      )}

      {view === 'scan' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setView('accueil')}
              className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:text-brand-ink hover:opacity-100 dark:hover:text-brand"
            >
              <ChevronLeft className="h-4 w-4" />
              Retour
            </button>
            <button
              onClick={() => setView('liste')}
              className="flex items-center gap-1.5 rounded-full bg-black/[0.06] px-3 py-1.5 text-sm font-semibold transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
            >
              <PackageCheck className="h-4 w-4 text-brand-ink dark:text-brand" />
              {recues.length} colis reçus aujourd&apos;hui
            </button>
          </div>

          {adminSansHub && (
            <Field label="Hub de réception">
              <select
                className="input-basic"
                value={hubChoisiId}
                onChange={(e) => setHubChoisiId(e.target.value)}
              >
                <option value="">Sélectionner un hub</option>
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

          {tournee && <TourneeHeader tournee={tournee} onReset={() => setTournee(null)} />}

          <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
            <div className="min-w-0 lg:sticky lg:top-20">
              <QrScanner active={view === 'scan'} onScan={handleScan} disabled={scanning} />
            </div>

            <div className="hidden min-w-0 lg:block">
              {tournee ? (
                <TourneeChecklist tournee={tournee} />
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
                      Colis reçus aujourd&apos;hui ({recues.length})
                    </h2>
                    <button
                      onClick={() => setView('liste')}
                      className="flex items-center gap-1.5 text-xs font-semibold text-brand-ink transition hover:underline dark:text-brand"
                    >
                      <List className="h-3.5 w-3.5" />
                      Plein écran
                    </button>
                  </div>
                  <ColisRecusTable recues={recues} />
                </>
              )}
            </div>
          </div>

          {tournee && (
            <div className="min-w-0 lg:hidden">
              <TourneeChecklist tournee={tournee} />
            </div>
          )}

          <button
            onClick={() => setView('liste')}
            className="flex items-center justify-center gap-2 rounded-xl border border-black/10 py-3 text-sm font-semibold opacity-80 transition hover:opacity-100 dark:border-white/10 lg:hidden"
          >
            <List className="h-4 w-4" />
            Voir les colis reçus ({recues.length})
          </button>
        </div>
      )}

      {view === 'liste' && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setView('scan')}
              className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:text-brand-ink hover:opacity-100 dark:hover:text-brand"
            >
              <ChevronLeft className="h-4 w-4" />
              Retour au scan
            </button>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <PackageCheck className="h-4 w-4 text-brand-ink dark:text-brand" />
              {recues.length} colis reçus aujourd&apos;hui
            </span>
          </div>

          <ColisRecusTable recues={recues} />
        </div>
      )}
    </div>
  );
}

function ColisRecusTable({ recues }: { recues: Commande[] }) {
  if (recues.length === 0) {
    return (
      <div className="empty-state table-card">
        <ScanLine className="h-8 w-8" />
        <p className="font-semibold">Aucun colis reçu pour l&apos;instant.</p>
        <p className="text-sm">Positionnez le QR code du colis dans le cadre de la caméra.</p>
      </div>
    );
  }

  return (
    <div className="table-card min-w-0 overflow-x-auto">
      <table className="table-basic">
        <thead>
          <tr>
            <th>Code</th>
            <th>Client</th>
            <th>Ville</th>
            <th>COD</th>
            <th>Heure</th>
            <th>Statut</th>
            <th>Hub</th>
          </tr>
        </thead>
        <tbody>
          {recues.map((c) => (
            <tr key={c.id}>
              <td className="font-mono font-semibold">{c.codeSuivi}</td>
              <td>{c.clientNom}</td>
              <td>{c.ville}</td>
              <td className="whitespace-nowrap">{c.montantCod} MAD</td>
              <td className="whitespace-nowrap">{c.dateReceptionHub ? formatHeure(c.dateReceptionHub) : '—'}</td>
              <td>
                <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
              </td>
              <td className="whitespace-nowrap">{c.hubActuel?.nom ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TourneeHeader({ tournee, onReset }: { tournee: TourneeState; onReset: () => void }) {
  const total = tournee.colis.length;
  const scanne = tournee.colis.filter((c) => c.statut === 'recu_au_hub').length;

  return (
    <div className="card-tint-strong flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide opacity-70">Tournée en cours</p>
        <p className="text-sm font-semibold">{tournee.ramasseurNom}</p>
      </div>
      <p className="text-2xl font-black">
        {scanne} <span className="text-sm font-semibold opacity-60">/ {total} colis</span>
      </p>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold opacity-80 transition hover:opacity-100 dark:border-white/10"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Terminer / Réinitialiser
      </button>
    </div>
  );
}

function TourneeChecklist({ tournee }: { tournee: TourneeState }) {
  const restants = tournee.colis.filter((c) => c.statut !== 'recu_au_hub');
  const scannes = tournee.colis.filter((c) => c.statut === 'recu_au_hub');

  return (
    <div className="flex flex-col gap-4">
      <div className="table-card min-w-0 overflow-x-auto">
        <p className="border-b border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide opacity-70 dark:border-white/10">
          Colis restants à scanner ({restants.length})
        </p>
        {restants.length === 0 ? (
          <div className="empty-state">
            <PackageCheck className="h-8 w-8" />
            <p className="font-semibold">Tournée entièrement scannée.</p>
          </div>
        ) : (
          <table className="table-basic">
            <thead>
              <tr>
                <th>Code</th>
                <th>Client</th>
                <th>Ville</th>
              </tr>
            </thead>
            <tbody>
              {restants.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono font-semibold">{c.codeSuivi}</td>
                  <td>{c.clientNom}</td>
                  <td>{c.ville}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scannes.length > 0 && (
        <div className="table-card min-w-0 overflow-x-auto">
          <p className="border-b border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide opacity-70 dark:border-white/10">
            Scannés ({scannes.length})
          </p>
          <table className="table-basic">
            <tbody>
              {scannes.map((c) => (
                <tr key={c.id} className="bg-green-500/10">
                  <td className="font-mono font-semibold text-green-700 dark:text-green-400">{c.codeSuivi}</td>
                  <td className="text-green-700 dark:text-green-400">{c.clientNom}</td>
                  <td className="text-green-700 dark:text-green-400">{c.ville}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
