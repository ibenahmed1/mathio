'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { BonEnvoiActionsMenu } from '@/components/BonEnvoiActionsMenu';
import { gereLesBons } from '@/lib/circuit-shipeh';
import { P, StatusPill } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';

// § Bons d'envoi — composition du tableau de bord admin (fond, cadrans, cartes,
// boutons et pilules de l'Accueil), comme « Colis prêts à envoyer ».

interface CurrentUser {
  role: 'admin' | 'agent_hub' | string;
}

type Filtre = 'tous' | 'nouveau' | 'recu';

const DEGRADES: [string, string][] = [
  ['#8ECAE6', '#209EBB'],
  ['#209EBB', '#023047'],
  ['#FFE14D', '#FFB701'],
  ['#FFB701', '#FC8500'],
  ['#023047', '#4A4A45'],
  ['#14526E', '#209EBB'],
  ['#FC8500', '#E56A00'],
];

function initiales(nom: string): string {
  return nom
    .replace(/^Hub\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
}

// Couleur stable par nom (même transporteur = même teinte sur toute la liste).
function degradeDe(nom: string): [string, string] {
  let h = 0;
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DEGRADES[h % DEGRADES.length];
}

function depuis(date: string): string {
  const jours = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  return `il y a ${jours} jours`;
}

export default function AdminBonEnvoiPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bons, setBons] = useState<BonEnvoi[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  // § Colis prêts à envoyer : le compteur du lien (lib/compteurs-nav.ts).
  const [pretsEnvoi, setPretsEnvoi] = useState<number | null>(null);

  function load() {
    apiGet<{ data: BonEnvoi[] }>('/api/bons-envoi?pageSize=100')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }

  useEffect(() => {
    apiGet<CurrentUser>('/api/auth/me').then(setUser).catch(() => {});
    apiGet<{ prets_envoi?: number }>('/api/compteurs')
      .then((c) => setPretsEnvoi(c.prets_envoi ?? null))
      .catch(() => {});
    load();
  }, []);

  const aRemettre = bons.filter((b) => b.statut === 'nouveau');
  const recus = bons.filter((b) => b.statut === 'recu');
  const colisEnCours = aRemettre.reduce((n, b) => n + b.nbColis, 0);
  const visibles = filtre === 'tous' ? bons : bons.filter((b) => b.statut === filtre);

  return (
    <main className={s.main}>
      <header className={s.entete}>
        <h1 className={s.titre}>Bons d&apos;envoi</h1>
        {gereLesBons(user?.role) && (
          // Un bon d'envoi se compose depuis les colis prêts, transporteur par
          // transporteur (/admin/bon-envoi/prets) ; la pastille dit combien attendent.
          <Link href="/admin/bon-envoi/prets" className={s.btnJaune}>
            <Plus className="h-4 w-4" /> Nouveau bon d&apos;envoi
            {pretsEnvoi !== null && pretsEnvoi > 0 && (
              <span className={s.compteurBtn} title={`${pretsEnvoi} colis prêts à envoyer`}>
                {pretsEnvoi > 99 ? '99+' : pretsEnvoi}
              </span>
            )}
          </Link>
        )}
      </header>

      {/* ===== Cadrans (ceux de l'Accueil) ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}>
          <span className={s.kpiLabel}>À remettre</span>
          <span className={s.kpiValeur}>{aRemettre.length}</span>
          <span className={s.kpiNote}>Bons pas encore reçus</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span className={s.kpiLabel}>Colis en route</span>
          <span className={s.kpiValeur}>{colisEnCours}</span>
          <span className={s.kpiNote}>Dans les bons à remettre</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span className={s.kpiLabel} style={{ color: P.jaune }}>Reçus</span>
          <span className={s.kpiValeur}>{recus.length}</span>
          <span className={s.kpiNote}>Pris en charge à destination</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
          <span className={s.kpiLabel}>Total des bons</span>
          <span className={s.kpiValeur}>{bons.length}</span>
          <span className={s.kpiNote}>{bons.reduce((n, b) => n + b.nbColis, 0)} colis au total</span>
        </div>
      </section>

      {error && <p style={{ fontSize: 13, fontWeight: 600, color: '#E56A00' }}>{error}</p>}

      <section className={`${s.card} ${s.panneau}`}>
        <div className={s.listeTete}>
          <h2 className={s.sectionTitre}>Tous les bons</h2>
          <div className={s.onglets} role="tablist">
            {(
              [
                ['tous', `Tous (${bons.length})`],
                ['nouveau', `À remettre (${aRemettre.length})`],
                ['recu', `Reçus (${recus.length})`],
              ] as [Filtre, string][]
            ).map(([cle, libelle]) => (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={filtre === cle}
                className={`${s.onglet} ${filtre === cle ? s.ongletActif : ''}`}
                onClick={() => setFiltre(cle)}
              >
                {libelle}
              </button>
            ))}
          </div>
        </div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Destination</th>
                <th>Colis</th>
                <th>Statut</th>
                <th>Généré le</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {visibles.map((b) => {
                // Un transporteur visé directement, ou le hub régional qu'il tient.
                const nom = b.prestataire?.nom ?? b.hubDestination?.prestataire?.nom ?? b.hubDestination?.nom ?? '—';
                const sous = b.prestataire
                  ? 'Remise directe au transporteur'
                  : b.hubDestination?.prestataire
                    ? `Vers ${b.hubDestination.nom}`
                    : 'Transit vers un de nos hubs';
                const [a, c] = degradeDe(nom);
                return (
                  <tr key={b.id} className={s.ligneBon}>
                    <td>
                      <Link href={`/admin/bon-envoi/${b.id}`} className={s.numero}>
                        {b.numero}
                      </Link>
                    </td>
                    <td>
                      <span className={s.destination}>
                        <span className={s.avatarPetit} style={{ background: `linear-gradient(135deg,${a},${c})` }}>
                          {initiales(nom)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span className={s.destNom}>{nom}</span>
                          <span className={s.destSous}>{sous}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={s.nbColis}>{b.nbColis}</span>
                    </td>
                    <td>
                      {b.statut === 'recu' ? (
                        <StatusPill label="Reçu" grad={['#209EBB', '#023047']} />
                      ) : (
                        <StatusPill label="À remettre" grad={['#FFB701', '#FC8500']} />
                      )}
                    </td>
                    <td>
                      {new Date(b.dateGeneration).toLocaleDateString('fr-FR')}
                      <span className={s.dateSous}>{depuis(b.dateGeneration)}</span>
                    </td>
                    <td>
                      {user && (
                        <BonEnvoiActionsMenu bon={b} role={gereLesBons(user.role) ? 'admin' : 'agent_hub'} onChanged={load} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length === 0 && <div className={s.vide}>Aucun bon d&apos;envoi dans cette vue.</div>}
        </div>
      </section>
    </main>
  );
}
