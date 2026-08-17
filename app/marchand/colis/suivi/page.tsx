'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';

interface HistoriqueEntry {
  id: string;
  ancienStatut: string | null;
  nouveauStatut: string;
  horodatage: string;
}

type CommandeAvecHistorique = Commande & { historique: HistoriqueEntry[] };

function SuiviColisContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [commande, setCommande] = useState<CommandeAvecHistorique | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function rechercher(valeur: string) {
    if (!valeur.trim()) return;
    setLoading(true);
    setError(null);
    setCommande(null);
    try {
      const res = await apiGet<{ data: Commande[] }>(`/api/commandes?search=${encodeURIComponent(valeur.trim())}`);
      const match = res.data.find((c) => c.codeSuivi.toLowerCase() === valeur.trim().toLowerCase()) ?? res.data[0];
      if (!match) {
        setError('Aucun colis trouvé pour ce code.');
        return;
      }
      const detail = await apiGet<CommandeAvecHistorique>(`/api/commandes/${match.id}`);
      setCommande(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  // Arrivée depuis le Command Menu (Ctrl+K) avec ?code=... : lance la
  // recherche automatiquement.
  useEffect(() => {
    const codeUrl = searchParams.get('code');
    if (codeUrl) rechercher(codeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    rechercher(code);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Suivi colis</h1>

      <form onSubmit={handleSearch} className="flex max-w-md gap-2">
        <input
          className="input-basic flex-1"
          placeholder="Code de suivi (ex. PD-000123)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
          <Search className="h-4 w-4" />
          Suivre
        </button>
      </form>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {commande && (
        <div className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-lg font-bold">{commande.codeSuivi}</p>
              <p className="text-sm opacity-70">
                {commande.clientNom} — {commande.ville}
              </p>
            </div>
            <StatutBadge statut={commande.statut} hubVille={commande.hubActuel?.ville} />
          </div>

          <ol className="flex flex-col gap-3 border-l-2 border-brand pl-4">
            {commande.historique.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="font-semibold">
                  <StatutBadge statut={h.nouveauStatut} />
                </p>
                <p className="opacity-60">{new Date(h.horodatage).toLocaleString('fr-FR')}</p>
              </li>
            ))}
            {commande.historique.length === 0 && <li className="text-sm opacity-60">Aucun historique</li>}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function SuiviColisPage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <SuiviColisContent />
    </Suspense>
  );
}
