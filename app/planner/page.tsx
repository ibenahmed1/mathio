'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Boxes, Lock, Plus, ScanLine, Share2, Truck, Undo2, Users } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDistribution, HubDistribution } from '@/lib/types';
import { LABELS_STATUT_BON_DISTRIBUTION, STYLE_STATUT_BON_DISTRIBUTION } from '@/lib/statuts';

interface MeResponse {
  nomComplet: string;
  role: string;
  hub?: { id: string; nom: string } | null;
}

function Kpi({
  icon: Icon,
  label,
  valeur,
  precision,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  valeur: string | number;
  precision?: string;
}) {
  return (
    <div className="card-tint-strong flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-2xl font-bold">{valeur}</span>
      {precision && <span className="text-xs opacity-60">{precision}</span>}
    </div>
  );
}

// § Accueil de la web app Planner : la journée type du Planner tient en deux
// mouvements — composer les tournées le matin (colis prêts au hub), les
// décharger le soir (tournées encore ouvertes). Cet écran ne fait que les
// rendre visibles d'un coup d'œil, sans nouvel endpoint : il agrège les
// mêmes routes que les autres écrans du module, déjà cantonnées au hub du
// Planner côté serveur.
export default function PlannerAccueilPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [hubs, setHubs] = useState<HubDistribution[]>([]);
  const [ouvertes, setOuvertes] = useState<BonDistribution[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MeResponse>('/api/auth/me')
      .then(setMe)
      .catch(() => {});

    apiGet<{ data: HubDistribution[] }>('/api/bons-distribution/zones')
      .then((res) => setHubs(res.data))
      .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));

    apiGet<{ data: BonDistribution[] }>('/api/bons-distribution?statut=en_cours&pageSize=100')
      .then((res) => setOuvertes(res.data))
      .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  // Pour un planner, /api/bons-distribution/zones ne renvoie que son propre
  // hub ; pour un admin, tous les hubs — les totaux ci-dessous ont donc le
  // même sens dans les deux cas, "mon périmètre".
  const colisAuHub = hubs.reduce((s, h) => s + (h.nbColisAuHub ?? 0), 0);
  const livreursActifs = hubs.reduce((s, h) => s + (h.nbLivreursActifs ?? 0), 0);
  const colisEnDistribution = ouvertes.reduce((s, b) => s + (b.nbColis ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Bonjour {me?.nomComplet ?? ''}</h1>
          <p className="text-sm opacity-70">
            {me?.hub ? `Planification des tournées du Hub ${me.hub.nom}` : 'Planification des tournées'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/planner/scan" className="btn-outline flex items-center gap-1.5">
            <ScanLine className="h-4 w-4" />
            Scanner
          </Link>
          <Link href="/planner/bons-distribution/creer" className="btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Nouveau Bon de Distribution
          </Link>
        </div>
      </div>

      {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Boxes} label="Colis prêts au hub" valeur={colisAuHub} precision="éligibles à une tournée" />
        <Kpi icon={Users} label="Livreurs actifs" valeur={livreursActifs} precision="rattachés au hub" />
        <Kpi icon={Share2} label="Tournées ouvertes" valeur={ouvertes.length} precision="à décharger au retour" />
        <Kpi icon={Truck} label="Colis en distribution" valeur={colisEnDistribution} precision="sortis du hub" />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Share2 className="h-4 w-4" />
            Tournées à clôturer
          </h2>
          <Link href="/planner/bons-distribution" className="text-xs font-semibold hover:underline">
            Voir tous les bons de distribution
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="table-basic min-w-[720px]">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Livreur</th>
                <th>Hub</th>
                <th>Colis</th>
                <th>Statut</th>
                <th>Générée le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ouvertes.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono">
                    <Link href={`/planner/bons-distribution/${b.id}`} className="hover:underline">
                      {b.numero}
                    </Link>
                  </td>
                  <td>{b.livreur?.nomComplet ?? '—'}</td>
                  <td>{b.hub?.nom ?? '—'}</td>
                  <td>{b.nbColis}</td>
                  <td>
                    <span className={`badge ${STYLE_STATUT_BON_DISTRIBUTION[b.statut]}`}>
                      {LABELS_STATUT_BON_DISTRIBUTION[b.statut]}
                    </span>
                  </td>
                  <td>{new Date(b.dateGeneration).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <Link
                      href={`/planner/bons-distribution/${b.id}/cloture`}
                      className="flex items-center gap-1 text-xs font-semibold hover:underline"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Décharger & clôturer
                    </Link>
                  </td>
                </tr>
              ))}
              {ouvertes.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center opacity-60">
                    <span className="flex items-center justify-center gap-1.5">
                      <Lock className="h-4 w-4" />
                      Aucune tournée ouverte — tout est rentré.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
