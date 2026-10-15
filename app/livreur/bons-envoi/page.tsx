'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { P, StatusPill } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';

// § /livreur/bons-envoi : les bons d'envoi confiés à ce transporteur, dans la
// composition exacte de la liste du back-office (/admin/bon-envoi) — mêmes
// cadrans, mêmes onglets, même tableau. Seules les actions de gestion
// (composer, modifier, transmettre) en sont absentes : elles restent chez nous.

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

export default function BonsEnvoiLivreurPage() {
  const [bons, setBons] = useState<BonEnvoi[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tous');

  useEffect(() => {
    apiGet<{ data: BonEnvoi[] }>('/api/livreur/bons-envoi')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  const enAttente = bons.filter((b) => b.statut === 'nouveau');
  const recus = bons.filter((b) => b.statut === 'recu');
  const colisEnAttente = enAttente.reduce((n, b) => n + b.nbColis, 0);
  const visibles = filtre === 'tous' ? bons : bons.filter((b) => b.statut === filtre);

  return (
    <main className={s.main}>
      <header className={s.entete}>
        <h1 className={s.titre}>Bons d&apos;envoi</h1>
      </header>

      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}>
          <span className={s.kpiLabel}>En attente de remise</span>
          <span className={s.kpiValeur}>{enAttente.length}</span>
          <span className={s.kpiNote}>Bons pas encore remis</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span className={s.kpiLabel}>Colis à venir</span>
          <span className={s.kpiValeur}>{colisEnAttente}</span>
          <span className={s.kpiNote}>Dans les bons à remettre</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span className={s.kpiLabel} style={{ color: P.jaune }}>Reçus</span>
          <span className={s.kpiValeur}>{recus.length}</span>
          <span className={s.kpiNote}>Pris en charge par vous</span>
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
                ['nouveau', `En attente (${enAttente.length})`],
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
                const nom = b.prestataire?.nom ?? b.hubDestination?.prestataire?.nom ?? b.hubDestination?.nom ?? '—';
                const sous = b.prestataire ? 'Remise directe' : b.hubDestination ? `Vers ${b.hubDestination.nom}` : '—';
                const [a, c] = degradeDe(nom);
                return (
                  <tr key={b.id} className={s.ligneBon}>
                    <td>
                      <Link href={`/livreur/bons-envoi/${b.id}`} className={s.numero}>
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
                        <StatusPill label="En attente de remise" grad={['#FFB701', '#FC8500']} />
                      )}
                    </td>
                    <td>
                      {new Date(b.dateGeneration).toLocaleDateString('fr-FR')}
                      <span className={s.dateSous}>{depuis(b.dateGeneration)}</span>
                    </td>
                    <td>
                      <Link href={`/livreur/bons-envoi/${b.id}`} className="btn-outline btn-sm">
                        Voir les colis
                      </Link>
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
