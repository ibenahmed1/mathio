'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Search, Store } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { MarchandAFacturer } from '@/lib/types';

// § /admin/factures/nouvelle — étape 1, « Clients à facturer ».
//
// Un TABLEAU et non une grille de cartes : à cette étape l'utilisateur ne
// cherche pas un marchand, il en COMPARE plusieurs pour décider lequel traiter
// en premier. Des colonnes alignées se comparent d'un coup d'œil ; des cartes
// obligent à relire chaque bloc.
//
// Trois signaux, et pas un de plus, parce que ce sont les trois qui décident :
//   - le COD en attente, c'est-à-dire l'argent de la plateforme qui dort ;
//   - le volume, qui dit combien de travail représente la facture ;
//   - l'ancienneté du plus vieux colis, qui dit l'urgence — un marchand avec
//     trois colis qui attendent depuis six semaines passe avant un marchand
//     avec deux cents colis d'hier, et c'est le seul des trois chiffres qui
//     n'apparaît nulle part ailleurs dans l'application.

function montant(valeur: number) {
  return `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

function joursDepuis(iso: string | null): number | null {
  if (!iso) return null;
  const ecart = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ecart / 86_400_000));
}

// Seuils d'ancienneté : au-delà de deux semaines, le reversement est en
// retard sur l'usage du marché marocain ; au-delà d'un mois, c'est un litige
// qui se prépare. Le rouge n'est donc pas décoratif, il désigne un risque.
function tonAnciennete(jours: number | null) {
  if (jours === null) return 'badge-neutral';
  if (jours >= 30) return 'badge-danger';
  if (jours >= 14) return 'badge-warn';
  return 'badge-neutral';
}

type Tri = 'cod' | 'anciennete' | 'volume';

export function ClientsAFacturer({
  onChoisir,
}: {
  onChoisir: (marchand: MarchandAFacturer) => void;
}) {
  const [marchands, setMarchands] = useState<MarchandAFacturer[] | null>(null);
  const [recherche, setRecherche] = useState('');
  const [tri, setTri] = useState<Tri>('cod');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: MarchandAFacturer[] }>('/api/factures/marchands')
      .then((res) => setMarchands(res.data))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Erreur');
        setMarchands([]);
      });
  }, []);

  const liste = useMemo(() => {
    let items = marchands ?? [];
    const q = recherche.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (m) =>
          m.nomBoutique.toLowerCase().includes(q) ||
          (m.raisonSociale ?? '').toLowerCase().includes(q) ||
          (m.ville ?? '').toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      if (tri === 'volume') return b.nbColisLivres + b.nbColisRetournes - (a.nbColisLivres + a.nbColisRetournes);
      if (tri === 'anciennete') {
        return (joursDepuis(b.attenteDepuis) ?? -1) - (joursDepuis(a.attenteDepuis) ?? -1);
      }
      return b.totalCod - a.totalCod;
    });
  }, [marchands, recherche, tri]);

  const cumul = useMemo(
    () =>
      (marchands ?? []).reduce(
        (acc, m) => ({
          clients: acc.clients + 1,
          colis: acc.colis + m.nbColisLivres + m.nbColisRetournes,
          cod: acc.cod + m.totalCod,
        }),
        { clients: 0, colis: 0, cod: 0 }
      ),
    [marchands]
  );

  const enRetard = (marchands ?? []).filter((m) => (joursDepuis(m.attenteDepuis) ?? 0) >= 14).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Clients à facturer</h1>
        <p className="mt-1 text-sm opacity-70">
          Marchands ayant au moins un colis clos non encore facturé. Les frais viennent de leur grille
          tarifaire par ville, avec repli sur les frais par défaut de leur fiche.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {/* Bandeau de cumul : ce que représente la file d'attente entière. Placé
          AVANT le tableau parce qu'il répond à la question qu'on se pose en
          arrivant — « combien reste-t-il à reverser en tout ? » */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="dashboard-card">
          <p className="text-xs uppercase tracking-wide opacity-60">COD en attente de reversement</p>
          <p className="font-mono text-2xl font-black tabular-nums">{montant(cumul.cod)}</p>
        </div>
        <div className="dashboard-card">
          <p className="text-xs uppercase tracking-wide opacity-60">Clients concernés</p>
          <p className="text-2xl font-black tabular-nums">{cumul.clients}</p>
          <p className="text-xs opacity-60">{cumul.colis} colis au total</p>
        </div>
        <div className={enRetard > 0 ? 'card-tint-soft' : 'dashboard-card'}>
          <p className="text-xs uppercase tracking-wide opacity-60">En attente depuis 14 jours ou plus</p>
          <p className="flex items-center gap-2 text-2xl font-black tabular-nums">
            {enRetard > 0 && <AlertTriangle className="h-5 w-5 text-amber-600" />}
            {enRetard}
          </p>
          <p className="text-xs opacity-60">{enRetard > 0 ? 'à traiter en priorité' : 'aucun retard'}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            className="input-basic w-full pl-9"
            placeholder="Boutique, raison sociale, ville…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="opacity-60">Trier par</span>
          {(
            [
              ['cod', 'COD en attente'],
              ['anciennete', 'Ancienneté'],
              ['volume', 'Volume'],
            ] as [Tri, string][]
          ).map(([valeur, label]) => (
            <button
              key={valeur}
              type="button"
              onClick={() => setTri(valeur)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                tri === valeur
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-black/[0.05] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-card overflow-x-auto">
        <table className="table-basic min-w-[760px]">
          <thead>
            <tr>
              <th>Client</th>
              <th className="text-right">Colis livrés</th>
              <th className="text-right">Retours</th>
              <th className="text-right">CRBT en attente</th>
              <th>En attente depuis</th>
              <th className="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {liste.map((m) => {
              const jours = joursDepuis(m.attenteDepuis);
              return (
                <tr key={m.marchandId}>
                  <td>
                    <span className="flex items-center gap-2 font-bold">
                      <Store className="h-4 w-4 shrink-0 opacity-40" />
                      {m.nomBoutique}
                    </span>
                    <span className="block pl-6 text-xs opacity-60">
                      {[m.raisonSociale, m.ville].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td className="text-right font-mono tabular-nums">{m.nbColisLivres}</td>
                  <td className="text-right font-mono tabular-nums opacity-70">
                    {m.nbColisRetournes > 0 ? m.nbColisRetournes : '—'}
                  </td>
                  <td className="text-right font-mono font-bold tabular-nums">{montant(m.totalCod)}</td>
                  <td>
                    <span className={`badge ${tonAnciennete(jours)}`}>
                      {jours === null ? 'date inconnue' : jours === 0 ? "aujourd'hui" : `${jours} j`}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => onChoisir(m)}
                      className="btn-primary flex items-center gap-1.5 whitespace-nowrap"
                    >
                      Générer la facture
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {marchands === null && (
              <tr>
                <td colSpan={6} className="py-10 text-center opacity-60">
                  Chargement…
                </td>
              </tr>
            )}
            {marchands !== null && liste.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <p className="font-semibold">
                      {recherche ? 'Aucun client ne correspond à cette recherche.' : 'Rien à facturer.'}
                    </p>
                    {!recherche && (
                      <p className="text-sm">
                        Un colis devient facturable une fois livré, ou une fois restitué au marchand par un
                        bon de retour.
                      </p>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Les retours n'apportent aucun COD mais coûtent des frais : le dire
          ici évite la question « pourquoi mon net est plus bas que le CRBT
          annoncé ? » au moment de l'émission. */}
      {cumul.colis > 0 && (
        <p className="text-xs opacity-60">
          Le CRBT affiché ne compte que les colis <strong>livrés</strong> — un colis retourné n&apos;a rien
          encaissé, il ne pèse sur la facture que par ses frais de retour.
        </p>
      )}
    </div>
  );
}
