'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { CodeColis } from '@/components/colis/CodeColis';

interface Mouvement {
  id: string;
  horodatage: string;
  type: 'annonce' | 'reception' | 'sortie_colis' | 'retour_colis' | 'retrait' | 'correction';
  quantite: number;
  motif: string | null;
  variante: { nom: string } | null;
  commande: { id: string; codeSuivi: string } | null;
  marchand: { nomBoutique: string } | null;
  envoi: { reference: string } | null;
  utilisateur: { nomComplet: string } | null;
}

interface Reponse {
  mouvements: Mouvement[];
  total: number;
  tronque: boolean;
  consommation: { marchandId: string; nomBoutique: string; consomme: number }[];
}

// Libellés et sens des compteurs : § lib/stock-mouvements.ts. Une annonce
// touche l'« en route », tout le reste le stock reçu.
const TYPES: Record<Mouvement['type'], string> = {
  annonce: 'Annoncé',
  reception: 'Reçu en entrepôt',
  sortie_colis: 'Sorti pour un colis',
  retour_colis: 'Revenu d’un colis',
  retrait: 'Retiré du stock',
  correction: 'Correction',
};

// § Journal des mouvements de stock (12/10/2026) : chaque entrée et sortie
// du produit, avec ce qui l'a causée. Pour un produit du stock commun d'une
// plateforme, ce que chaque vendeur en a consommé — la base de sa facturation.
export function JournalMouvements({ produitId, rafraichir }: { produitId: string; rafraichir: number }) {
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Reponse>(`/api/produits/${produitId}/mouvements`)
      .then(setDonnees)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [produitId, rafraichir]);

  if (error) return <p className="text-sm font-medium text-red-600">{error}</p>;
  if (!donnees) return null;

  return (
    <>
      {donnees.consommation.length > 0 && (
        <div className="table-card">
          <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Consommation par vendeur</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>Vendeur</th>
                  <th className="text-right">Unités consommées</th>
                </tr>
              </thead>
              <tbody>
                {donnees.consommation.map((c) => (
                  <tr key={c.marchandId}>
                    <td>{c.nomBoutique}</td>
                    <td className="text-right font-semibold">{c.consomme}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Journal des mouvements</h2>
          {donnees.tronque && (
            <span className="text-xs opacity-60">
              {donnees.mouvements.length} plus récents sur {donnees.total}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[820px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mouvement</th>
                <th className="text-right">Quantité</th>
                <th>Cause</th>
                <th>Vendeur</th>
                <th>Par</th>
              </tr>
            </thead>
            <tbody>
              {donnees.mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(m.horodatage).toLocaleString('fr-FR')}</td>
                  <td>
                    {TYPES[m.type]}
                    {m.variante && <span className="opacity-60"> — {m.variante.nom}</span>}
                  </td>
                  <td
                    className={`text-right font-semibold ${m.quantite < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}
                  >
                    {m.quantite > 0 ? `+${m.quantite}` : m.quantite}
                  </td>
                  <td className="text-xs">
                    {m.commande ? (
                      <span>
                        Colis <CodeColis id={m.commande.id} code={m.commande.codeSuivi} />
                      </span>
                    ) : m.envoi ? (
                      <span>Envoi {m.envoi.reference}</span>
                    ) : (
                      <span className="opacity-60">{m.motif ?? '—'}</span>
                    )}
                  </td>
                  <td className="text-xs">{m.marchand?.nomBoutique ?? '—'}</td>
                  <td className="text-xs opacity-60">{m.utilisateur?.nomComplet ?? '—'}</td>
                </tr>
              ))}
              {donnees.mouvements.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-sm opacity-50">
                    Aucun mouvement journalisé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
