'use client';

import { MapPin, Package, PackageCheck, Phone, Share2, Truck, Undo2 } from 'lucide-react';
import {
  P,
  PERIMETRE,
  StatusPill,
  TON,
  cardTitle,
  courbe,
  dirhams,
  kpiValue,
  muted,
  nombre,
  type TonColis,
} from '@/components/dashboard/composition';
import s from '@/components/admin/DashboardAccueil.module.css';

// Accueil de l'espace livreur, dans la composition EXACTE du tableau de bord
// du back-office (§ components/admin/DashboardAccueil.tsx) : même surface
// pleine largeur, mêmes cartes, mêmes rangées, même palette — la feuille de
// mise en page est littéralement la sienne, importée telle quelle, et le
// vocabulaire visuel vient du module partagé. L'écran précédent posait ses
// propres cartes jaunes et ses propres barres de progression : deux dialectes
// dans une seule maison.
//
// Ce que l'écran raconte, dans l'ordre où un livreur se pose les questions :
// ce que j'ai en caisse et ce qu'il me reste à livrer (cadrans), comment se
// tient mon activité sur la période (courbe), ce que deviennent mes colis
// (donut), ce que j'ai à faire maintenant (feuille de route) et ce que je
// viens de traiter (table).

export type ColisAccueilLivreur = {
  id: string;
  codeSuivi: string;
  client: string;
  ville: string;
  telephone: string;
  montantCod: number;
  // Libellé d'affichage du statut, décidé en amont : le composant dessine une
  // pilule, il ne connaît pas le catalogue des statuts.
  statut: string;
  ton: TonColis;
};

export type DashboardLivreurProps = {
  // --- Tournée en cours (feuille de route) ---
  cashEncaisse: number;
  aLivrer: number;
  // --- Période sélectionnée ---
  colisTotal: number;
  colisLivres: number;
  colisRetournes: number;
  tauxRetour: number;
  tournees: { total: number; enCours: number; nbColisTotal: number };
  volume: { label: string; recus: number; livres: number }[];
  // --- Listes ---
  feuilleDeRoute: ColisAccueilLivreur[];
  traites: ColisAccueilLivreur[];
  // Sélecteur de plage de dates, rendu par la page (c'est elle qui porte
  // l'état du filtre) et posé dans l'en-tête du graphe, à la place qu'occupe
  // le sélecteur JOUR/SEMAINE/MOIS du back-office.
  periode?: React.ReactNode;
};

const ICONE_TON: Record<TonColis, React.ComponentType<{ className?: string }>> = {
  livre: PackageCheck,
  retour: Undo2,
  amont: Package,
  encours: Truck,
};

export function DashboardLivreur({
  cashEncaisse,
  aLivrer,
  colisTotal,
  colisLivres,
  colisRetournes,
  tauxRetour,
  tournees,
  volume,
  feuilleDeRoute,
  traites,
  periode,
}: DashboardLivreurProps) {
  // Échelle commune aux deux courbes : deux échelles indépendantes feraient
  // croiser des volumes qui ne se croisent pas.
  const maxVolume = Math.max(1, ...volume.flatMap((j) => [j.recus, j.livres]));
  const totalRecus = volume.reduce((n, j) => n + j.recus, 0);
  const totalLivres = volume.reduce((n, j) => n + j.livres, 0);

  // Trois tranches du donut. Les arcs sont calculés sur les VALEURS BRUTES et
  // non sur des pourcentages arrondis : le back-office doit arrondir parce
  // qu'il affiche aussi le « % » dans sa légende, ici la légende donne des
  // colis — autant ne pas introduire le trou d'un centième dans le cercle.
  const enCours = Math.max(0, colisTotal - colisLivres - colisRetournes);
  const familles = [
    { label: 'Livrés', valeur: colisLivres, grad: 'tgLivreur0' },
    { label: 'En cours', valeur: enCours, grad: 'tgLivreur1' },
    { label: 'Retournés', valeur: colisRetournes, grad: 'tgLivreur2' },
  ];
  const totalFamilles = familles.reduce((n, f) => n + f.valeur, 0);
  const arcs = familles.map((f, i) => ({
    grad: f.grad,
    longueur: totalFamilles > 0 ? (f.valeur / totalFamilles) * PERIMETRE : 0,
    offset:
      totalFamilles > 0
        ? -familles.slice(0, i).reduce((n, precedente) => n + (precedente.valeur / totalFamilles) * PERIMETRE, 0)
        : 0,
  }));

  return (
    <main className={s.main}>
      {/* ===== Cadrans KPI (ordre de la palette) ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Cash encaissé</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{dirhams(cashEncaisse)}</span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>À remettre au dépôt</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none">
              <g stroke="rgba(2,48,71,0.6)" strokeWidth="3" strokeLinecap="round">
                <path d="M3 30V18" />
                <path d="M11 30V10" />
                <path d="M19 30V22" />
                <path d="M27 30V6" />
                <path d="M35 30V14" />
                <path d="M43 30V20" />
                <path d="M51 30V4" />
              </g>
            </svg>
          </div>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: P.jaune }}>Colis livrés</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{nombre(colisLivres)}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>Sur la période</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none">
              <path
                d="M2 26 C10 26 12 8 20 12 C28 16 30 28 38 22 C46 16 48 6 56 8"
                stroke={P.jaune}
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Taux de retour</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{tauxRetour.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>Retours et annulations</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none">
              <path
                d="M2 18 C8 10 12 26 18 20 C24 14 28 24 34 16 C40 8 44 22 50 14 C53 10 55 12 56 10"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </div>
        <div
          className={s.kpi}
          style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>À livrer</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{nombre(aLivrer)}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>Tournée en cours</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none">
              <g stroke="rgba(2,48,71,0.55)" strokeWidth="3" strokeLinecap="round">
                <path d="M3 30V20" />
                <path d="M11 30V8" />
                <path d="M19 30V24" />
                <path d="M27 30V12" />
                <path d="M35 30V18" />
                <path d="M43 30V6" />
                <path d="M51 30V16" />
              </g>
            </svg>
          </div>
        </div>
      </section>

      {/* ===== Graphe principal + Répartition ===== */}
      <section className={s.row2}>
        <div className={`${s.card} ${s.chartCard}`}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <h2 style={cardTitle}>Mon volume sur la période</h2>
            {periode}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#6E6E68' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFD000' }} />
                Livrés
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#219EBC' }} />
                Confiés
              </span>
            </div>
          </div>
          <div className={s.chartBody}>
            <div className={s.chartStats}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(totalRecus)}</span>
                <span style={muted}>Colis confiés</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(totalLivres)}</span>
                <span style={muted}>Colis livrés</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end' }}>
              <svg
                viewBox="0 0 600 200"
                preserveAspectRatio="none"
                style={{ width: '100%', height: 200, display: 'block' }}
              >
                <defs>
                  <linearGradient id="gLivreurA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFB701" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#FFB701" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="gLivreurB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8ECAE6" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#8ECAE6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g stroke="#F2F2EF" strokeWidth="1">
                  <path d="M0 40H600" />
                  <path d="M0 80H600" />
                  <path d="M0 120H600" />
                  <path d="M0 160H600" />
                </g>
                {(() => {
                  const recus = courbe(
                    volume.map((j) => j.recus),
                    600,
                    200,
                    maxVolume
                  );
                  const livres = courbe(
                    volume.map((j) => j.livres),
                    600,
                    200,
                    maxVolume
                  );
                  return (
                    <>
                      <path d={`${recus} V200 H0 Z`} fill="url(#gLivreurB)" />
                      <path d={recus} fill="none" stroke="#219EBC" strokeWidth="2" />
                      <path d={`${livres} V200 H0 Z`} fill="url(#gLivreurA)" />
                      <path d={livres} fill="none" stroke="#FFD000" strokeWidth="2.2" />
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>
          <div className={s.chartFooter}>
            {[
              {
                label: 'Tournées sur la période',
                val: nombre(tournees.total),
                bg: '#FFB701',
                fg: '#1A1A18',
                Icone: Share2,
              },
              { label: 'Tournées en cours', val: nombre(tournees.enCours), bg: '#FFF3D1', fg: '#9A6E00', Icone: Truck },
              {
                label: 'Colis distribués',
                val: nombre(tournees.nbColisTotal),
                bg: '#E4F2F9',
                fg: '#14708A',
                Icone: Package,
              },
            ].map((it) => (
              <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: it.bg,
                    color: it.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 34px',
                  }}
                >
                  <it.Icone className="h-4 w-4" />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={muted}>{it.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{it.val}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`${s.card} ${s.trafficCard}`}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={cardTitle}>Répartition</h2>
            <span style={muted}>Sur la période</span>
          </div>
          <div style={{ position: 'relative', alignSelf: 'center', width: 190, height: 190, marginTop: 6 }}>
            <svg viewBox="0 0 190 190" style={{ width: 190, height: 190, transform: 'rotate(-90deg)' }}>
              <defs>
                <linearGradient id="tgLivreur0" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#209EBB" />
                  <stop offset="100%" stopColor="#023047" />
                </linearGradient>
                <linearGradient id="tgLivreur1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FFE14D" />
                  <stop offset="100%" stopColor="#FFD000" />
                </linearGradient>
                <linearGradient id="tgLivreur2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FC8500" />
                  <stop offset="100%" stopColor="#E56A00" />
                </linearGradient>
              </defs>
              <circle cx="95" cy="95" r="76" fill="none" stroke="#F2F2EF" strokeWidth="18" />
              {arcs.map((arc) => (
                <circle
                  key={arc.grad}
                  cx="95"
                  cy="95"
                  r="76"
                  fill="none"
                  stroke={`url(#${arc.grad})`}
                  strokeWidth="18"
                  strokeLinecap="round"
                  strokeDasharray={`${arc.longueur} ${PERIMETRE}`}
                  strokeDashoffset={arc.offset}
                />
              ))}
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(totalFamilles)}</span>
              <span style={muted}>Colis au total</span>
            </div>
          </div>
          <div className={s.trafficLegend}>
            {familles.map((f, i) => (
              <div
                key={f.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 4px 12px',
                  borderBottom: '3px solid transparent',
                  borderImage: `${
                    [
                      'linear-gradient(90deg,#209EBB,#023047)',
                      'linear-gradient(90deg,#FFE14D,#FFD000)',
                      'linear-gradient(90deg,#FC8500,#E56A00)',
                    ][i] ?? 'linear-gradient(90deg,#8ECAE6,#209EBB)'
                  } 1`,
                }}
              >
                <span style={muted}>{f.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{nombre(f.valeur)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Feuille de route + Derniers colis traités ===== */}
      <section className={s.row3}>
        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
            <h2 style={cardTitle}>Ma feuille de route</h2>
            <span style={muted}>Les prochains colis à remettre</span>
          </div>
          {feuilleDeRoute.length === 0 && <span style={muted}>Rien à livrer pour le moment.</span>}
          {feuilleDeRoute.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: '1px solid #F4F4F1' }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  border: '1px solid #E8E8E5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 34px',
                  color: '#3A3A36',
                }}
              >
                <Truck className="h-4 w-4" />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.client}</span>
                <span style={{ fontSize: 11, color: '#A3A39C', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <MapPin className="h-3 w-3" />
                  {c.ville} · <b style={{ color: '#6E6E68' }}>{dirhams(c.montantCod)}</b>
                </span>
                {/* Le numéro reste cliquable : c'est le geste que le livreur
                    fait le plus souvent depuis cet écran, et un <a href="tel:">
                    est le seul moyen de le lui donner sur son téléphone. */}
                <a
                  href={`tel:${c.telephone}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#14708A',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Phone className="h-3 w-3" />
                  {c.telephone}
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 style={cardTitle}>Derniers colis traités</h2>
            <span style={muted}>Les cinq plus récents de la tournée en cours</span>
          </div>
          <div className={s.tableWrap}>
            <div className={s.table}>
              {['SUIVI', 'CLIENT', 'VILLE', 'CRBT', 'STATUT'].map((h, i, arr) => (
                <span
                  key={h}
                  style={{
                    background: '#F6F6F5',
                    padding: '10px 12px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#8C8C86',
                    borderRadius: i === 0 ? '8px 0 0 8px' : i === arr.length - 1 ? '0 8px 8px 0' : 0,
                  }}
                >
                  {h}
                </span>
              ))}
              {traites.map((c) => {
                const IconeTon = ICONE_TON[c.ton];
                return (
                  <div key={c.id} style={{ display: 'contents' }}>
                    <span style={{ padding: '13px 12px', borderBottom: '1px solid #F4F4F1', fontWeight: 600 }}>
                      {c.codeSuivi}
                    </span>
                    <span style={{ padding: '13px 12px', borderBottom: '1px solid #F4F4F1', color: '#4A4A45' }}>
                      {c.client}
                    </span>
                    <span style={{ padding: '13px 12px', borderBottom: '1px solid #F4F4F1', color: '#8C8C86' }}>
                      {c.ville}
                    </span>
                    <span
                      style={{
                        padding: '13px 12px',
                        borderBottom: '1px solid #F4F4F1',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {dirhams(c.montantCod)}
                    </span>
                    <span
                      style={{
                        padding: '11px 12px',
                        borderBottom: '1px solid #F4F4F1',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                      }}
                    >
                      <IconeTon className="h-3.5 w-3.5" />
                      <StatusPill label={c.statut} grad={TON[c.ton]} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {traites.length === 0 && <span style={muted}>Aucun colis traité sur la tournée en cours.</span>}
        </div>
      </section>
    </main>
  );
}
