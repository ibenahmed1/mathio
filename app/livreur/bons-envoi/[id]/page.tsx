'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, DoorOpen, TriangleAlert } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { StatutBadge } from '@/components/StatutBadge';
import { P, StatusPill } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';

// § /livreur/bons-envoi/[id] : détail d'un bon confié au transporteur, dans la
// composition des écrans de travail du back-office (§ /admin/bon-envoi) — mêmes
// cadrans et mêmes pilules de statut que la liste des bons, colis dans
// le tableau de la liste des colis du back-office (/admin/commandes), réduit
// aux colonnes utiles à la livraison.

interface ColisBon {
  id: string;
  codeSuivi: string;
  dateCreation: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  adresse: string;
  montantCod: string;
  statut: string;
  notes: string | null;
  ouvrir: boolean;
  fragile: boolean;
  aRemplacer: boolean;
  produitDescription: string | null;
  marchand: { nomBoutique: string } | null;
  marchandise: { nom: string } | null;
}

interface BonTransporteur {
  id: string;
  numero: string;
  statut: 'nouveau' | 'recu';
  nbColis: number;
  dateGeneration: string;
  dateReception: string | null;
  hubDestination: { nom: string; prestataire: { nom: string } | null } | null;
  prestataire: { id: string; nom: string } | null;
  commandes: ColisBon[];
}

export default function DetailBonEnvoiLivreurPage() {
  const params = useParams<{ id: string }>();
  const [bon, setBon] = useState<BonTransporteur | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<BonTransporteur>(`/api/livreur/bons-envoi/${params.id}`)
      .then(setBon)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoading(false));
  }, [params.id]);

  const retour = (
    <Link href="/livreur/bons-envoi" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100">
      <ChevronLeft className="h-4 w-4" />
      Retour aux Bons d&apos;Envoi
    </Link>
  );

  if (loading) {
    return (
      <main className={s.main}>
        <p style={{ fontSize: 13, color: '#6B6B66' }}>Chargement…</p>
      </main>
    );
  }

  if (error || !bon) {
    return (
      <main className={s.main}>
        {retour}
        <p style={{ fontSize: 13, fontWeight: 600, color: '#E56A00' }}>{error ?? "Bon d'envoi introuvable"}</p>
      </main>
    );
  }

  const codTotal = bon.commandes.reduce((t, c) => t + Number(c.montantCod), 0);
  const livres = bon.commandes.filter((c) => c.statut === 'livre');
  const codEncaisse = livres.reduce((t, c) => t + Number(c.montantCod), 0);
  const recu = bon.statut === 'recu';

  return (
    <main className={s.main}>
      {retour}

      <header className={s.entete}>
        <div>
          <h1 className={s.titre}>{bon.numero}</h1>
          <p style={{ fontSize: 13, color: '#6B6B66', marginTop: 4 }}>
            {bon.prestataire ? 'Remise directe' : `Vers ${bon.hubDestination?.nom ?? '—'}`} · généré le{' '}
            {new Date(bon.dateGeneration).toLocaleString('fr-FR')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {recu ? (
            <StatusPill label="Reçu" grad={['#209EBB', '#023047']} />
          ) : (
            <StatusPill label="En attente de remise" grad={['#FFB701', '#FC8500']} />
          )}
          {/* Bon pris en charge : les colis se traitent depuis « Mes colis ». */}
          {recu && (
            <Link href="/livreur/colis" className={s.btnJaune}>
              Traiter mes colis
            </Link>
          )}
        </div>
      </header>

      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}>
          <span className={s.kpiLabel}>Colis</span>
          <span className={s.kpiValeur}>{bon.nbColis}</span>
          <span className={s.kpiNote}>Dans ce bon</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span className={s.kpiLabel}>COD total</span>
          <span className={s.kpiValeur}>{codTotal.toFixed(2)} DH</span>
          <span className={s.kpiNote}>À encaisser si tout est livré</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span className={s.kpiLabel} style={{ color: P.jaune }}>Livrés</span>
          <span className={s.kpiValeur}>{livres.length}</span>
          <span className={s.kpiNote}>Cash encaissé : {codEncaisse.toFixed(2)} DH</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
          <span className={s.kpiLabel}>{recu ? 'Reçu le' : 'Remise'}</span>
          <span className={s.kpiValeur} style={{ fontSize: recu ? 22 : undefined }}>
            {recu && bon.dateReception ? new Date(bon.dateReception).toLocaleDateString('fr-FR') : 'À venir'}
          </span>
          <span className={s.kpiNote}>
            {recu && bon.dateReception
              ? new Date(bon.dateReception).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : 'Colis pas encore remis'}
          </span>
        </div>
      </section>

      {!recu && (
        <p style={{ fontSize: 12, color: '#6B6B66' }}>
          Ce bon n&apos;est pas encore remis : vous pourrez traiter ses colis depuis « Mes colis » dès qu&apos;il sera marqué
          reçu.
        </p>
      )}

      <div className={s.listeTete}>
        <h2 className={s.sectionTitre}>Colis du bon ({bon.commandes.length})</h2>
      </div>

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[1200px]">
            <thead>
              <tr>
                <th>Code d&apos;envoi</th>
                <th>Date d&apos;expédition</th>
                <th>Destinataire</th>
                <th>Téléphone</th>
                <th>Nom du magasin</th>
                <th>Marchandise</th>
                <th>Ville</th>
                <th>Adresse</th>
                <th className="text-right">Prix</th>
                <th>Status</th>
                <th>Options</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {bon.commandes.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                  <td>{c.clientNom}</td>
                  <td className="whitespace-nowrap">
                    <a href={`tel:${c.clientTelephone}`} className="hover:underline">
                      {c.clientTelephone}
                    </a>
                  </td>
                  <td>{c.marchand?.nomBoutique ?? '—'}</td>
                  <td>{c.marchandise?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                  <td>{c.ville}</td>
                  <td className="max-w-[200px] truncate text-xs" title={c.adresse}>
                    {c.adresse}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{c.montantCod} DH</td>
                  <td>
                    <StatutBadge statut={c.statut} />
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {c.ouvrir && (
                        <span className="badge badge-neutral">
                          <DoorOpen className="h-3 w-3" /> Ouvrir
                        </span>
                      )}
                      {c.fragile && (
                        <span className="badge badge-warn">
                          <TriangleAlert className="h-3 w-3" /> Fragile
                        </span>
                      )}
                      {c.aRemplacer && <span className="badge badge-brand">Échange</span>}
                    </div>
                  </td>
                  <td className="max-w-[160px] truncate text-xs opacity-70" title={c.notes ?? undefined}>
                    {c.notes ?? '—'}
                  </td>
                </tr>
              ))}
              {bon.commandes.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-4 text-center opacity-60">
                    Aucun colis dans ce bon.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
