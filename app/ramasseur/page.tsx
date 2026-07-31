'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande, Ramassage } from '@/lib/types';
import { Logo } from '@/components/Logo';

export default function RamasseurPage() {
  const router = useRouter();
  const [ramassages, setRamassages] = useState<Ramassage[]>([]);
  const [ramassageId, setRamassageId] = useState('');
  const [codeSuivi, setCodeSuivi] = useState('');
  const [scannes, setScannes] = useState<Commande[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRamassages() {
    const res = await apiGet<{ data: Ramassage[] }>('/api/ramassages');
    setRamassages(res.data.filter((r) => r.statut === 'en_attente' || r.statut === 'confirmee'));
  }

  useEffect(() => {
    loadRamassages();
  }, []);

  async function loadDetail(id: string) {
    if (!id) {
      setScannes([]);
      return;
    }
    const detail = await apiGet<Ramassage>(`/api/ramassages/${id}`);
    setScannes(detail.commandes?.filter((c) => c.statut === 'ramasse') ?? []);
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!ramassageId) {
      setError('Choisissez une tournée de ramassage');
      return;
    }
    try {
      const commande = await apiPost<Commande>(`/api/ramassages/${ramassageId}/scans`, { codeSuivi });
      setMessage(`Colis ${commande.codeSuivi} réceptionné.`);
      setCodeSuivi('');
      loadDetail(ramassageId);
      loadRamassages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleLogout() {
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <nav className="flex items-center justify-between bg-black px-6 py-3">
        <Logo />
        <button onClick={handleLogout} className="text-sm font-semibold text-white/70 hover:text-brand">
          Déconnexion
        </button>
      </nav>
      <div className="border-b-4 border-brand" />

      <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
        <h1 className="page-title">Scan de réception</h1>

        <select
          className="input-basic"
          value={ramassageId}
          onChange={(e) => {
            setRamassageId(e.target.value);
            loadDetail(e.target.value);
          }}
        >
          <option value="">Choisir une tournée…</option>
          {ramassages.map((r) => (
            <option key={r.id} value={r.id}>
              {r.marchand?.nomBoutique} — {new Date(r.datePrevue).toLocaleDateString('fr-FR')}
            </option>
          ))}
        </select>

        <form onSubmit={handleScan} className="flex gap-2">
          <input
            className="input-basic flex-1 font-mono"
            placeholder="PD-100000"
            value={codeSuivi}
            onChange={(e) => setCodeSuivi(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary">
            Scanner
          </button>
        </form>

        {message && <p className="text-sm font-medium text-green-700">{message}</p>}
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide opacity-70">
            Colis réceptionnés pour cette tournée ({scannes.length})
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {scannes.map((c) => (
              <li key={c.id} className="rounded border-l-4 border-brand bg-black/5 px-3 py-2 font-mono dark:bg-white/5">
                {c.codeSuivi} — {c.clientNom}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
