'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { LABELS_STATUT_COMMANDE, tonColisDuStatut } from '@/lib/statuts';
import type { DashboardLivreurStats } from '@/lib/types';
import { DashboardLivreur, type ColisAccueilLivreur } from '@/components/livreur/DashboardLivreur';
import type { StatutCommande } from '@/app/generated/prisma/enums';

// § /livreur (Accueil). La page ne fait que réunir les deux sources et les
// mettre à la forme attendue par le tableau de bord : la période (stats et
// courbe, GET /api/livreur/dashboard) et la tournée en cours (caisse, colis à
// remettre, colis déjà traités, GET /api/livreur/tournee). Toute la
// présentation vit dans DashboardLivreur, qui reprend la composition du
// tableau de bord du back-office.

interface ColisTournee {
  id: string;
  codeSuivi: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  montantCod: string;
  statut: string;
}

interface FeuilleDeRoute {
  colis: ColisTournee[];
  recap: { nbColis: number; nbLivres: number; nbEnCours: number; nbARetourner: number; cashEncaisse: string };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function plageParDefaut() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

// Le statut arrive du JSON comme une chaîne. Il vient de l'enum Prisma côté
// serveur, mais rien dans le type ne le dit : on le vérifie contre le
// catalogue plutôt que de le forcer, sans quoi un statut inconnu ferait
// afficher « undefined » en guise de libellé.
function versColisAccueil(c: ColisTournee): ColisAccueilLivreur {
  const statut = c.statut as StatutCommande;
  const libelle = LABELS_STATUT_COMMANDE[statut] ?? c.statut;
  return {
    id: c.id,
    codeSuivi: c.codeSuivi,
    client: c.clientNom,
    ville: c.ville,
    telephone: c.clientTelephone,
    montantCod: Number(c.montantCod),
    statut: libelle,
    ton: tonColisDuStatut(statut),
  };
}

export default function LivreurDashboardPage() {
  const [plage, setPlage] = useState(plageParDefaut());
  const [plageEnCours, setPlageEnCours] = useState(plage);
  const [stats, setStats] = useState<DashboardLivreurStats | null>(null);
  const [feuille, setFeuille] = useState<FeuilleDeRoute | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setErreur(null);
      apiGet<DashboardLivreurStats>(`/api/livreur/dashboard?from=${plage.from}&to=${plage.to}`)
        .then(setStats)
        .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
    });
  }, [plage]);

  // La feuille de route ne dépend pas de la plage : elle dit l'état de la
  // tournée EN COURS. Elle est donc chargée une seule fois, et un changement
  // de période ne la fait pas clignoter.
  useEffect(() => {
    queueMicrotask(() => {
      apiGet<FeuilleDeRoute>('/api/livreur/tournee')
        .then(setFeuille)
        .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
    });
  }, []);

  const colis = feuille?.colis ?? [];
  const aTenter = colis.filter((c) => c.statut === 'mise_en_distribution');
  const traites = colis.filter((c) => c.statut !== 'mise_en_distribution');

  const filtrePeriode = (
    <form
      style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F6F6F5', borderRadius: 8, padding: 3 }}
      onSubmit={(e) => {
        e.preventDefault();
        setPlage(plageEnCours);
      }}
    >
      <input
        type="date"
        aria-label="Début de période"
        value={plageEnCours.from}
        max={plageEnCours.to}
        onChange={(e) => setPlageEnCours((p) => ({ ...p, from: e.target.value }))}
        style={{
          border: 'none',
          background: '#FFF',
          borderRadius: 6,
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 11,
          color: '#4A4A45',
        }}
      />
      <input
        type="date"
        aria-label="Fin de période"
        value={plageEnCours.to}
        min={plageEnCours.from}
        onChange={(e) => setPlageEnCours((p) => ({ ...p, to: e.target.value }))}
        style={{
          border: 'none',
          background: '#FFF',
          borderRadius: 6,
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 11,
          color: '#4A4A45',
        }}
      />
      <button
        type="submit"
        style={{
          border: 'none',
          background: 'linear-gradient(135deg,#209EBB,#023047)',
          color: '#FFF',
          borderRadius: 6,
          padding: '7px 12px',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Filtrer
      </button>
    </form>
  );

  return (
    <>
      {erreur && (
        <p
          style={{
            margin: 0,
            padding: '12px 26px 0',
            background: '#F0F0ED',
            color: '#b04a37',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {erreur}
        </p>
      )}
      <DashboardLivreur
        cashEncaisse={Number(feuille?.recap.cashEncaisse ?? 0)}
        aLivrer={feuille?.recap.nbEnCours ?? 0}
        colisTotal={stats?.colis.total ?? 0}
        colisLivres={stats?.colis.livres ?? 0}
        colisRetournes={stats?.colis.retournes ?? 0}
        tauxRetour={stats?.colis.tauxRetourne ?? 0}
        tournees={{
          total: stats?.bonsDistribution.total ?? 0,
          enCours: stats?.bonsDistribution.enCours ?? 0,
          nbColisTotal: stats?.bonsDistribution.nbColisTotal ?? 0,
        }}
        volume={stats?.volume ?? []}
        feuilleDeRoute={aTenter.slice(0, 5).map(versColisAccueil)}
        traites={traites.slice(0, 5).map(versColisAccueil)}
        periode={filtrePeriode}
      />
    </>
  );
}
