'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { Logo } from '@/components/Logo';
import { QrScanner } from '@/components/QrScanner';
import { StatutBadge } from '@/components/StatutBadge';
import { ChevronLeft, List, LogOut, PackageCheck, ScanLine, Truck } from 'lucide-react';

interface RamasseurUser {
  id: string;
  nomComplet: string;
}

type Toast = { type: 'success' | 'error'; text: string } | null;

function formatHeure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function RamasseurPage() {
  const router = useRouter();
  const [user, setUser] = useState<RamasseurUser | null>(null);
  const [view, setView] = useState<'accueil' | 'scan' | 'liste'>('accueil');
  const [scannees, setScannees] = useState<Commande[]>([]);
  const [loadingScannees, setLoadingScannees] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    apiGet<RamasseurUser>('/api/auth/me').then(setUser).catch(() => {});
  }, []);

  // Retrouve "mes colis scannés aujourd'hui" au chargement (survit à un
  // rafraîchissement de page) : le tableau n'est pas qu'un état mémoire.
  useEffect(() => {
    if (!user) return;
    apiGet<{ data: Commande[] }>(
      `/api/commandes?ramasseurId=${user.id}&statut=ramasse&dateCollecteFrom=${encodeURIComponent(startOfTodayIso())}&pageSize=100`
    )
      .then((res) =>
        setScannees(
          [...res.data].sort((a, b) => new Date(b.dateCollecte ?? 0).getTime() - new Date(a.dateCollecte ?? 0).getTime())
        )
      )
      .catch(() => {})
      .finally(() => setLoadingScannees(false));
  }, [user]);

  async function handleScan(raw: string) {
    if (scanning) return;
    setScanning(true);
    setToast(null);
    try {
      // Le QR imprimé sur l'étiquette encode le numéro de série signé
      // ("VILLE-CODE-DATE.SOMME") — reconnaissable au point avant le checksum.
      // La saisie manuelle envoie elle un codeSuivi brut ("PD-000123").
      const body = raw.includes('.') ? { qrPayload: raw } : { codeSuivi: raw };
      const commande = await apiPost<Commande>('/api/commandes/scan', body);
      setToast({ type: 'success', text: `Colis ${commande.codeSuivi} — ${commande.clientNom} réceptionné.` });
      setScannees((prev) => [commande, ...prev.filter((c) => c.id !== commande.id)]);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
    } finally {
      setScanning(false);
    }
  }

  async function handleLogout() {
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  return (
    <div className="min-h-screen shell-surface">
      <nav className="sticky top-0 z-20 flex items-center justify-between bg-black px-4 py-3 sm:px-6">
        <Logo />
        <div className="flex items-center gap-4">
          {user && <span className="hidden text-sm font-semibold text-white/80 sm:block">Bonjour, {user.nomComplet.split(' ')[0]}</span>}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-brand"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </nav>
      <div className="border-b-4 border-brand" />

      {view === 'accueil' && (
        <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pt-10 sm:p-6 sm:pt-16">
          <div className="text-center">
            <h1 className="page-title flex items-center justify-center gap-2">
              <Truck className="h-6 w-6 text-brand-ink dark:text-brand" />
              Ramassage des colis
            </h1>
            <p className="mt-1 text-sm opacity-70">
              {user ? `Bonjour ${user.nomComplet.split(' ')[0]}, prêt` : 'Prêt'} à récupérer les colis du jour ?
            </p>
          </div>

          <div className="card-tint-strong flex flex-col items-center gap-1 py-6 text-center">
            <span className="text-xs font-bold uppercase tracking-wide opacity-80">Colis ramassés aujourd&apos;hui</span>
            <span className="text-5xl font-black">{loadingScannees ? '—' : scannees.length}</span>
          </div>

          <button
            onClick={() => setView('scan')}
            className="btn-primary flex items-center justify-center gap-2 py-4 text-base"
          >
            <ScanLine className="h-5 w-5" />
            Commencer le scan
          </button>

          {scannees.length > 0 && (
            <button
              onClick={() => setView('liste')}
              className="flex items-center justify-center gap-2 rounded-xl border border-black/10 py-3 text-sm font-semibold opacity-80 transition hover:opacity-100 dark:border-white/10"
            >
              <List className="h-4 w-4" />
              Voir les colis scannés ({scannees.length})
            </button>
          )}

          <p className="text-center text-xs opacity-60">
            Ouvrez la caméra et positionnez le QR code de chaque colis récupéré : son statut passera automatiquement
            d&apos;« Attente de ramassage » à « Ramassé ».
          </p>
        </main>
      )}

      {view === 'scan' && (
        <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
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
              {scannees.length} colis ramassés aujourd&apos;hui
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

          {/* Sur mobile, seule la caméra reste à l'écran : le tableau (large,
              colonnes non compressibles) est réservé à la vue "liste" dédiée
              pour éviter de forcer la page en largeur desktop. */}
          <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
            <div className="min-w-0 lg:sticky lg:top-20">
              <QrScanner active={view === 'scan'} onScan={handleScan} disabled={scanning} />
            </div>

            <div className="hidden min-w-0 lg:block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
                  Colis scannés aujourd&apos;hui ({scannees.length})
                </h2>
                <button
                  onClick={() => setView('liste')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-brand-ink transition hover:underline dark:text-brand"
                >
                  <List className="h-3.5 w-3.5" />
                  Plein écran
                </button>
              </div>
              <ColisScannesTable scannees={scannees} nomRamasseur={user?.nomComplet} />
            </div>
          </div>

          <button
            onClick={() => setView('liste')}
            className="flex items-center justify-center gap-2 rounded-xl border border-black/10 py-3 text-sm font-semibold opacity-80 transition hover:opacity-100 dark:border-white/10 lg:hidden"
          >
            <List className="h-4 w-4" />
            Voir les colis scannés ({scannees.length})
          </button>
        </main>
      )}

      {view === 'liste' && (
        <main className="mx-auto flex max-w-6xl min-w-0 flex-col gap-4 p-4 sm:p-6">
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
              {scannees.length} colis ramassés aujourd&apos;hui
            </span>
          </div>

          <ColisScannesTable scannees={scannees} nomRamasseur={user?.nomComplet} />
        </main>
      )}
    </div>
  );
}

function ColisScannesTable({ scannees, nomRamasseur }: { scannees: Commande[]; nomRamasseur?: string }) {
  if (scannees.length === 0) {
    return (
      <div className="empty-state table-card">
        <ScanLine className="h-8 w-8" />
        <p className="font-semibold">Aucun colis scanné pour l&apos;instant.</p>
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
            <th>Ramasseur</th>
          </tr>
        </thead>
        <tbody>
          {scannees.map((c) => (
            <tr key={c.id}>
              <td className="font-mono font-semibold">{c.codeSuivi}</td>
              <td>{c.clientNom}</td>
              <td>{c.ville}</td>
              <td className="whitespace-nowrap">{c.montantCod} MAD</td>
              <td className="whitespace-nowrap">{c.dateCollecte ? formatHeure(c.dateCollecte) : '—'}</td>
              <td>
                <StatutBadge statut={c.statut} />
              </td>
              <td className="whitespace-nowrap">{nomRamasseur ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
