'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { apiGet, apiPatch, apiDelete, apiPost } from '@/lib/api-client';
import type { Marchand } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { ReinitialiserMotDePasse } from '@/components/ReinitialiserMotDePasse';

export default function AdminMarchandsPage() {
  const [marchands, setMarchands] = useState<Marchand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiGet<{ data: Marchand[] }>('/api/marchands');
      setMarchands(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  async function changerStatut(id: string, statut: string) {
    setError(null);
    try {
      await apiPatch(`/api/marchands/${id}/statut`, { statut });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimer(id: string, nomBoutique: string) {
    setError(null);
    if (!window.confirm(`Supprimer définitivement le compte "${nomBoutique}" ? Cette action est irréversible.`)) {
      return;
    }
    try {
      await apiDelete(`/api/marchands/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  // Ouvre l'espace marchand dans un nouvel onglet : pose une vraie session
  // marchand (cookie pd_session_marchand) sans toucher à la session admin en
  // cours, qui reste active dans l'onglet courant.
  async function accederEspace(id: string) {
    setError(null);
    // Ouvert tout de suite dans le gestionnaire de clic — pas après le await
    // ci-dessous, sinon les navigateurs bloquent silencieusement le popup
    // (le lien avec le geste utilisateur est perdu après un appel async).
    const onglet = window.open('', '_blank');
    try {
      // L'espace marchand vit sur un autre domaine racine : le back-office ne
      // peut pas y poser de cookie. L'API renvoie une URL de transfert à usage
      // unique (60 s) que l'onglet cible échange contre une vraie session.
      const { url } = await apiPost<{ url: string }>(`/api/marchands/${id}/impersonation`);
      if (onglet) {
        onglet.location.href = url;
      } else {
        setError("Le navigateur a bloqué l'ouverture du nouvel onglet. Autorisez les popups pour ce site puis réessayez.");
      }
    } catch (err) {
      onglet?.close();
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Marchands</h1>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <table className="table-basic">
        <thead>
          <tr>
            <th>Boutique</th>
            <th>Contact</th>
            <th>Ville</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {marchands.map((m) => (
            <tr key={m.id}>
              <td>
                <Link href={`/admin/marchands/${m.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {m.nomBoutique}
                </Link>
              </td>
              <td>
                <div className="flex flex-col">
                  <span>{m.utilisateur?.nomComplet}</span>
                  <span className="text-xs opacity-60">
                    {m.utilisateur?.telephone ?? '—'}
                    {m.utilisateur?.email ? ` · ${m.utilisateur.email}` : ''}
                  </span>
                </div>
              </td>
              <td>{m.ville ?? '—'}</td>
              <td>
                <StatutBadge statut={m.statut} />
              </td>
              <td className="flex flex-wrap gap-2">
                {m.statut === 'actif' ? (
                  <button
                    onClick={() => accederEspace(m.id)}
                    className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
                    title="Se connecter dans l'espace de ce marchand, dans un nouvel onglet"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Accéder à l&apos;espace
                  </button>
                ) : (
                  <button
                    onClick={() => changerStatut(m.id, 'actif')}
                    className="btn-outline px-2 py-1 text-xs"
                    title="Approuver le compte pour pouvoir y accéder"
                  >
                    Approuver
                  </button>
                )}
                {m.statut !== 'suspendu' && (
                  <button onClick={() => changerStatut(m.id, 'suspendu')} className="btn-outline px-2 py-1 text-xs">
                    Suspendre
                  </button>
                )}
                {resetId === m.utilisateurId ? (
                  <ReinitialiserMotDePasse utilisateurId={m.utilisateurId} onDone={() => setResetId(null)} />
                ) : (
                  <button onClick={() => setResetId(m.utilisateurId)} className="btn-outline px-2 py-1 text-xs">
                    Réinitialiser mot de passe
                  </button>
                )}
                <button
                  onClick={() => supprimer(m.id, m.nomBoutique)}
                  className="btn-outline px-2 py-1 text-xs text-red-600 dark:text-red-400"
                >
                  Supprimer
                </button>
              </td>
            </tr>
          ))}
          {marchands.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center opacity-60">
                Aucun marchand
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
