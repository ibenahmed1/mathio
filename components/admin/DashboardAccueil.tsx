'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  PackagePlus,
  Plus,
  TrendingDown,
  TrendingUp,
  Truck,
  Undo2,
} from 'lucide-react';
import s from './DashboardAccueil.module.css';

// Tableau de bord de l'Accueil back-office, porté de la maquette
// « Améliorer l'interface du dashboard ».
//
// Ce qui est BRANCHÉ sur la base (props ci-dessous) : les quatre cadrans, la
// courbe des 7 derniers jours et ses trois compteurs de pied, le donut de
// répartition, les activités récentes, la table des derniers colis et les
// principales villes.
//
// Ce qui reste STATIQUE (repris tel quel de la maquette, en attente d'une
// source) : la carte du monde, la « Vue d'ensemble » mensuelle et les deux
// sparklines de la colonne de droite. Chaque bloc concerné le redit sur
// place — ne pas confondre ces chiffres avec des chiffres de production.
//
// L'agrégat mensuel n'est volontairement PAS branché : `Commande.dateCreation`
// ne porte pas d'index (§ prisma/schema.prisma), un regroupement par mois
// imposerait donc un parcours complet de la table à chaque affichage de
// l'Accueil. À faire quand l'index existera.

/* ===== Palette =====
   Les valeurs de la maquette d'origine (§ « Améliorer l'interface du
   dashboard »), qui est la planche WSKZ .04 : bleu ciel, bleu, marine, plus
   l'ambre et l'orange — les mêmes que `--pal-*` dans app/globals.css.
   Elles sont redites ici plutôt que lues dans les variables CSS parce que d3
   et les attributs SVG en ont besoin comme CHAÎNES au moment du rendu :
   `var(--pal-bleu)` posé en `fill` n'est pas résolu par d3.
   Le jaune (btnJaune, #FFE14D → #FFD000) sert À LA FOIS de couleur de
   commande et de couleur de donnée — il ferme le donut, porte la courbe des
   livraisons et le quatrième cadran. C'est le parti de la maquette : sur cet
   écran il n'y a aucune zone cliquable jaune en dehors des deux boutons, et
   leur forme (fond plein, ombre portée) les distingue d'une série. */
const P = {
  bleuClair: '#8ECAE6',
  teal: '#209EBB',
  navy: '#023047',
  navy2: '#14526E',
  jaune: '#FFB701',
  orange: '#FC8500',
  orangeFonce: '#E56A00',
  btnJaune: 'linear-gradient(180deg,#FFE14D,#FFD000)',
  btnNavy: 'linear-gradient(135deg,#209EBB,#023047)',
};

// Dégradé de la pilule de statut, repris de `GRAD` dans la maquette. Les clés
// disent le MOMENT DU CYCLE et non une couleur : lib/dashboard-accueil.ts n'a
// pas à être retouché au prochain changement de palette.
// Le bleu clair pour ce qui entre, l'ambre pour ce qui est en cours de
// traitement, le marine pour ce qui est abouti, l'orange pour ce qui sort du
// flux — un retour n'est pas un échec neutre, il coûte une tournée, et la
// teinte chaude est là pour qu'il se repère dans une colonne de statuts.
const TON = {
  amont: ['#8ECAE6', '#209EBB'],
  encours: ['#FFB701', '#FC8500'],
  livre: ['#209EBB', '#023047'],
  retour: ['#FC8500', '#E56A00'],
};

/* ===== Styles de base (composition) ===== */
const cardTitle: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700 };
const muted: React.CSSProperties = { fontSize: 11, color: '#8C8C86' };
const kpiValue: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' };

/* ===== Contrat de données ===== */

export type TonColis = 'amont' | 'encours' | 'livre' | 'retour';

// Une journée de la courbe des 7 derniers jours.
export type VolumeJourAccueil = {
  label: string;
  nouveaux: number;
  ramasses: number;
  livres: number;
};

// Les trois familles du donut. `part` est déjà un pourcentage entier : le
// calcul vit côté serveur, le composant ne fait que dessiner.
export type FamilleStatut = {
  label: string;
  valeur: number;
  part: number;
};

export type ColisRecent = {
  id: string;
  codeSuivi: string;
  client: string;
  ville: string;
  montantCod: number;
  statut: string;
  // Moment du cycle de vie — décidé côté serveur à partir du statut réel, pour
  // que le composant reste ignorant du catalogue des statuts.
  ton: TonColis;
};

export type ActiviteRecente = {
  id: string;
  titre: string;
  depuis: string;
  qui: string;
  action: string;
  // Même découpage que la pilule de la table : il choisit ici l'icône du
  // mouvement (livré, retour, amont de chaîne, en cours).
  ton: TonColis;
};

export type ZoneClient = {
  nom: string;
  valeur: number;
  part: number;
};

export type DashboardAccueilProps = {
  totalColis: number;
  colisLivres: number;
  tauxRetour: number;
  encaissementsCod: number;
  colisEnAttente: number;
  colisRamasses: number;
  demandesRamassageEnAttente: number;
  volume7j: VolumeJourAccueil[];
  familles: FamilleStatut[];
  colisRecents: ColisRecent[];
  activites: ActiviteRecente[];
  zones: ZoneClient[];
};

/* ===== Formats ===== */
const nombre = (n: number) => n.toLocaleString('fr-FR');
const dirhams = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DH`;

/* ===== Pilule statut : bordure + texte dégradés, fond blanc ===== */
function StatusPill({ label, grad }: { label: string; grad: string[] }) {
  const [a, b] = grad;
  return (
    <span
      style={{
        display: 'inline-flex',
        padding: 1.5,
        borderRadius: 20,
        background: `linear-gradient(135deg,${a},${b})`,
      }}
    >
      <span style={{ display: 'inline-block', padding: '4px 11px', borderRadius: 20, background: '#FFF' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            background: `linear-gradient(135deg,${a},${b})`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {label}
        </span>
      </span>
    </span>
  );
}

// Trace une courbe lissée passant par les points fournis (milieux quadratiques)
// : la maquette portait des `d` écrits à la main, il faut désormais les
// produire à partir des volumes réels.
function courbe(valeurs: number[], largeur: number, hauteur: number, max: number): string {
  if (valeurs.length === 0) return '';
  const pas = valeurs.length > 1 ? largeur / (valeurs.length - 1) : largeur;
  const y = (v: number) => hauteur - (max > 0 ? (v / max) * (hauteur - 12) : 0) - 6;
  const pts = valeurs.map((v, i) => [i * pas, y(v)] as const);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

// Longueur d'arc d'un segment du donut, sur le cercle r=76 de la maquette.
const PERIMETRE = 2 * Math.PI * 76;

// La maquette posait des caractères Unicode (◆, ●, ‹ ›, ▲ ▼) en guise
// d'icônes : ils dépendent des polices installées sur le poste et tombaient à
// vide. On rend de vraies icônes lucide, comme partout ailleurs dans le
// back-office, en gardant exactement les pastilles et les couleurs du modèle.
const ICONE_ACTIVITE: Record<TonColis, React.ComponentType<{ className?: string }>> = {
  livre: PackageCheck,
  retour: Undo2,
  amont: PackagePlus,
  encours: Truck,
};

/* ===== Données encore statiques (maquette) ===== */
const barres = [
  [90, 60, 140],
  [70, 50, 120],
  [110, 85, 160],
  [75, 100, 145],
  [55, 90, 130],
  [95, 65, 150],
  [45, 80, 125],
];

export function DashboardAccueil({
  totalColis,
  colisLivres,
  tauxRetour,
  encaissementsCod,
  colisEnAttente,
  colisRamasses,
  demandesRamassageEnAttente,
  volume7j,
  familles,
  colisRecents,
  activites,
  zones,
  children,
}: DashboardAccueilProps & { children?: React.ReactNode }) {
  const [tab, setTab] = useState('MOIS');
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [d3, topojson] = await Promise.all([import('d3'), import('topojson-client')]);
        const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
        const topo = await res.json();
        if (dead || !mapRef.current) return;
        const countries = topojson.feature(topo, topo.objects.countries) as unknown as {
          features: { id: string }[];
        };
        const el = mapRef.current;
        const w = el.clientWidth || 700;
        const h = el.clientHeight || 320;
        const proj = d3.geoNaturalEarth1().fitSize([w, h], countries as never);
        const path = d3.geoPath(proj);
        const colors: Record<string, string> = {
          '012': '#FFB701',
          '250': '#219EBC',
          '504': '#FC8500',
          '788': '#FC8500',
          '724': '#023047',
          '380': '#14526E',
        };
        const svg = d3
          .create('svg')
          .attr('viewBox', `0 0 ${w} ${h}`)
          .style('width', '100%')
          .style('height', '100%');
        svg
          .selectAll('path')
          .data(countries.features)
          .join('path')
          .attr('d', path as never)
          .attr('fill', (f) => colors[f.id] || '#E8E8E5')
          .attr('stroke', '#FFF')
          .attr('stroke-width', 0.5);
        el.innerHTML = '';
        el.appendChild(svg.node() as Node);
      } catch {
        /* carte indisponible : fond neutre */
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const tabStyle = (t: string): React.CSSProperties => ({
    border: 'none',
    fontFamily: 'inherit',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    ...(tab === t ? { background: P.btnNavy, color: '#FFF' } : { background: 'transparent', color: '#8C8C86' }),
  });

  // Échelle commune aux deux courbes : deux échelles indépendantes feraient
  // croiser des volumes qui ne se croisent pas.
  const maxVolume = Math.max(1, ...volume7j.flatMap((j) => [j.nouveaux, j.livres]));
  const totalSemaine = volume7j.reduce((n, j) => n + j.nouveaux + j.ramasses + j.livres, 0);
  const livresSemaine = volume7j.reduce((n, j) => n + j.livres, 0);

  // Décalages cumulés des arcs du donut : chaque segment démarre là où le
  // précédent s'arrête. Le cumul se lit dans le tableau déjà construit plutôt
  // que dans un accumulateur mutable — la règle react-hooks/immutability
  // interdit d'écrire dans une variable de rendu.
  const arcs = familles.map((f, i) => ({
    longueur: (f.part / 100) * PERIMETRE,
    offset: -familles.slice(0, i).reduce((n, precedente) => n + (precedente.part / 100) * PERIMETRE, 0),
    grad: `tgAccueil${i}`,
  }));
  const totalFamilles = familles.reduce((n, f) => n + f.valeur, 0);

  return (
    <main className={s.main}>
      {/* ===== Cadrans KPI (ordre de la palette) ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div
          className={s.kpi}
          style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>Encaissements COD</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{dirhams(encaissementsCod)}</span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>Colis livrés, cumul</span>
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
          <span style={{ fontSize: 13, fontWeight: 600, color: P.jaune }}>Colis traités</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{nombre(totalColis)}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>Depuis l&apos;ouverture</span>
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
          <span style={{ fontSize: 13, fontWeight: 600 }}>Colis livrés</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={kpiValue}>{nombre(colisLivres)}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>Cumul, tous marchands</span>
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

      {/* ===== Graphe principal + Trafic ===== */}
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
            <h2 style={cardTitle}>Volume des 7 derniers jours</h2>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 2, background: '#F6F6F5', borderRadius: 8, padding: 3 }}
            >
              {['JOUR', 'SEMAINE', 'MOIS'].map((t) => (
                <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#6E6E68' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFD000' }} />
                Livrés
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#219EBC' }} />
                Nouveaux
              </span>
            </div>
          </div>
          <div className={s.chartBody}>
            <div className={s.chartStats}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(totalSemaine)}</span>
                <span style={muted}>Colis sur la semaine</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(livresSemaine)}</span>
                <span style={muted}>Livrés sur la semaine</span>
              </div>
              <button
                className={s.btnYellow}
                style={{
                  alignSelf: 'flex-start',
                  border: 'none',
                  background: P.btnJaune,
                  color: '#1A1A18',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '10px 16px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  marginTop: 4,
                  boxShadow: '0 2px 6px rgba(255,208,0,0.45)',
                }}
              >
                Résumé du mois dernier
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end' }}>
              <svg viewBox="0 0 600 200" preserveAspectRatio="none" style={{ width: '100%', height: 200, display: 'block' }}>
                <defs>
                  <linearGradient id="gAccueilA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFB701" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#FFB701" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="gAccueilB" x1="0" y1="0" x2="0" y2="1">
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
                  const nouveaux = courbe(volume7j.map((j) => j.nouveaux), 600, 200, maxVolume);
                  const livres = courbe(volume7j.map((j) => j.livres), 600, 200, maxVolume);
                  return (
                    <>
                      <path d={`${nouveaux} V200 H0 Z`} fill="url(#gAccueilB)" />
                      <path d={nouveaux} fill="none" stroke="#219EBC" strokeWidth="2" />
                      <path d={`${livres} V200 H0 Z`} fill="url(#gAccueilA)" />
                      <path d={livres} fill="none" stroke="#FFD000" strokeWidth="2.2" />
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>
          <div className={s.chartFooter}>
            {[
              { label: 'Nouveaux colis', val: nombre(colisEnAttente), bg: '#FFB701', fg: '#1A1A18', Icone: PackagePlus },
              { label: 'Colis ramassés', val: nombre(colisRamasses), bg: '#FFF3D1', fg: '#9A6E00', Icone: PackageCheck },
              {
                label: 'Ramassages en attente',
                val: nombre(demandesRamassageEnAttente),
                bg: '#E4F2F9',
                fg: '#14708A',
                Icone: ClipboardList,
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
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #E8E8E5',
                background: '#FFF',
                borderRadius: 8,
                padding: '6px 10px',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                color: '#6E6E68',
                cursor: 'pointer',
              }}
            >
              TOTAL
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <div style={{ position: 'relative', alignSelf: 'center', width: 190, height: 190, marginTop: 6 }}>
            <svg viewBox="0 0 190 190" style={{ width: 190, height: 190, transform: 'rotate(-90deg)' }}>
              <defs>
                <linearGradient id="tgAccueil0" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8ECAE6" />
                  <stop offset="100%" stopColor="#209EBB" />
                </linearGradient>
                <linearGradient id="tgAccueil1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#209EBB" />
                  <stop offset="100%" stopColor="#023047" />
                </linearGradient>
                <linearGradient id="tgAccueil2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FFE14D" />
                  <stop offset="100%" stopColor="#FFD000" />
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
                      'linear-gradient(90deg,#8ECAE6,#209EBB)',
                      'linear-gradient(90deg,#209EBB,#023047)',
                      'linear-gradient(90deg,#FFE14D,#FFD000)',
                    ][i] ?? 'linear-gradient(90deg,#8ECAE6,#209EBB)'
                  } 1`,
                }}
              >
                <span style={muted}>{f.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{f.part} %</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Activités + Statut des commandes ===== */}
      <section className={s.row3}>
        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ ...cardTitle, marginBottom: 14 }}>Activités récentes</h2>
          {activites.length === 0 && <span style={muted}>Aucun mouvement enregistré pour l&apos;instant.</span>}
          {activites.map((a) => {
            const IconeActivite = ICONE_ACTIVITE[a.ton];
            return (
            <div key={a.id} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: '1px solid #F4F4F1' }}>
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
                <IconeActivite className="h-4 w-4" />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.titre}</span>
                <span style={{ fontSize: 11, color: '#A3A39C' }}>
                  Il y a {a.depuis} · <b style={{ color: '#6E6E68' }}>{a.qui}</b> {a.action}
                </span>
              </div>
            </div>
            );
          })}
        </div>

        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 style={cardTitle}>Derniers colis</h2>
              <span style={muted}>Les cinq plus récents, tous marchands</span>
            </div>
            <button
              className={s.btnNavy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: 'none',
                background: P.btnNavy,
                color: '#FFF',
                borderRadius: 8,
                padding: '9px 14px',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus className="h-4 w-4" />
              Ajouter facture
            </button>
          </div>
          <div className={s.tableWrap}>
            <div className={s.table}>
              {['SUIVI', 'CLIENT', 'VILLE', 'COD', 'STATUT'].map((h, i, arr) => (
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
              {colisRecents.map((c) => (
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
                  <span style={{ padding: '13px 12px', borderBottom: '1px solid #F4F4F1', fontWeight: 600 }}>
                    {dirhams(c.montantCod)}
                  </span>
                  <span style={{ padding: '9px 12px', borderBottom: '1px solid #F4F4F1' }}>
                    <StatusPill label={c.statut} grad={TON[c.ton]} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 'auto',
            }}
          >
            <span style={muted}>
              Affichage de {colisRecents.length === 0 ? 0 : 1} à {colisRecents.length} sur {nombre(totalColis)} colis
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {['prec', '1', '2', '3', '4', 'suiv'].map((p) => (
                <button
                  key={p}
                  aria-label={p === 'prec' ? 'Page precedente' : p === 'suiv' ? 'Page suivante' : `Page ${p}`}
                  style={{
                    width: 26,
                    height: 26,
                    border: 'none',
                    borderRadius: 7,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...(p === '1'
                      ? { background: P.btnJaune, color: '#1A1A18', fontWeight: 700 }
                      : { background: 'transparent', color: '#4A4A45' }),
                  }}
                >
                  {p === 'prec' ? (
                    <ChevronLeft className="h-3.5 w-3.5" />
                  ) : p === 'suiv' ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    p
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Zones clients + Carte ===== */}
      <section className={s.row4}>
        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={cardTitle}>Principales zones clients</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{nombre(totalColis)}</span>
            <span style={muted}>
              {zones.length > 0 ? `La plupart des colis partent vers ${zones[0].nom}` : 'Aucune ville servie pour l’instant'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {zones.map((z, i) => (
              <div
                key={z.nom}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 0',
                  borderBottom: '1px solid #F4F4F1',
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: ['#FFB701', '#FC8500', '#219EBC', '#1B7F98', '#FC8500', '#34342F'][i % 6],
                    flex: '0 0 8px',
                  }}
                />
                <span style={{ flex: 1, color: '#4A4A45', fontWeight: 500 }}>{z.nom}</span>
                <span style={{ fontWeight: 700 }}>{nombre(z.valeur)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1B7F98', width: 44, textAlign: 'right' }}>
                  {z.part} %
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* Carte du monde (d3 + topojson, atlas chargé depuis jsDelivr) : reprise
            telle quelle de la maquette. Purement décorative — le coloriage des
            pays est en dur et ne reflète aucune donnée du réseau. */}
        <div className={s.card} style={{ padding: 14, position: 'relative', minHeight: 340 }}>
          <div
            ref={mapRef}
            style={{ position: 'absolute', inset: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          />
        </div>
      </section>

      {/* ===== Vue d'ensemble + Sparklines =====
          Ces trois blocs sont ENCORE STATIQUES : ils reprennent les valeurs de
          la maquette. Voir le commentaire en tête de fichier. */}
      <section className={s.row5}>
        <div className={s.card} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <h2 style={cardTitle}>Vue d&apos;ensemble</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: '#6E6E68' }}>
              {[
                ['Livré', 'linear-gradient(135deg,#FFEB99,#FFD84D)'],
                ['En cours', 'linear-gradient(135deg,#C9E7F5,#8ECAE6)'],
                ['Annulé', 'linear-gradient(135deg,#FFD1A3,#FFB701)'],
              ].map(([l, g]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: g }} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                fontSize: 10,
                color: '#A3A39C',
                textAlign: 'right',
                paddingBottom: 22,
              }}
            >
              <span>20k</span>
              <span>15k</span>
              <span>10k</span>
              <span>5k</span>
              <span>1k</span>
              <span>0</span>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <svg viewBox="0 0 640 220" preserveAspectRatio="none" style={{ width: '100%', height: 220, display: 'block' }}>
                <defs>
                  <linearGradient id="bgAccueil1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFEB99" />
                    <stop offset="100%" stopColor="#FFD84D" />
                  </linearGradient>
                  <linearGradient id="bgAccueil2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C9E7F5" />
                    <stop offset="100%" stopColor="#8ECAE6" />
                  </linearGradient>
                  <linearGradient id="bgAccueil3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD1A3" />
                    <stop offset="100%" stopColor="#FFB701" />
                  </linearGradient>
                </defs>
                <g stroke="#F2F2EF" strokeWidth="1">
                  {[0, 44, 88, 132, 176, 220].map((y) => (
                    <path key={y} d={`M0 ${y}H640`} />
                  ))}
                </g>
                <g>
                  {barres.map(([a, b, c], i) => {
                    const x = 30 + i * 90;
                    return (
                      <g key={i}>
                        <rect x={x} y={220 - (220 - a)} width="9" height={220 - a} rx="4" fill="url(#bgAccueil1)" />
                        <rect x={x + 13} y={b} width="9" height={220 - b} rx="4" fill="url(#bgAccueil2)" />
                        <rect x={x + 26} y={c} width="9" height={220 - c} rx="4" fill="url(#bgAccueil3)" />
                      </g>
                    );
                  })}
                </g>
              </svg>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#A3A39C',
                  padding: '6px 24px 0',
                }}
              >
                <span>Jan</span>
                <span>Fév</span>
                <span>Mar</span>
                <span>Avr</span>
                <span>Mai</span>
                <span>Juin</span>
                <span>Juil</span>
              </div>
            </div>
          </div>
        </div>

        <div className={s.sparkCol}>
          <div className={s.card} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6E6E68' }}>Revenu total</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>2 509 640 DH</span>
            <svg viewBox="0 0 220 46" preserveAspectRatio="none" style={{ width: '100%', height: 46 }}>
              <defs>
                <linearGradient id="spAccueil1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFB701" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#FFB701" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 36 C20 30 30 16 50 20 C70 24 80 34 100 26 C120 18 130 8 150 14 C170 20 185 10 200 6 C210 3 215 5 220 4 V46 H0 Z"
                fill="url(#spAccueil1)"
              />
              <path
                d="M0 36 C20 30 30 16 50 20 C70 24 80 34 100 26 C120 18 130 8 150 14 C170 20 185 10 200 6 C210 3 215 5 220 4"
                fill="none"
                stroke="#FC8500"
                strokeWidth="2"
              />
            </svg>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6E6E68' }}>
              <TrendingUp className="h-3.5 w-3.5" style={{ color: '#1B7F98' }} />
              <b style={{ color: '#1B7F98' }}>+12,08 %</b> vs semaine dernière
            </span>
          </div>
          <div className={s.card} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6E6E68' }}>Dépenses totales</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>183 000 DH</span>
            <svg viewBox="0 0 220 46" preserveAspectRatio="none" style={{ width: '100%', height: 46 }}>
              <defs>
                <linearGradient id="spAccueil2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8ECAE6" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#8ECAE6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 14 C20 20 30 30 50 26 C70 22 80 12 100 18 C120 24 130 34 150 30 C170 26 185 34 200 38 C210 40 215 38 220 40 V46 H0 Z"
                fill="url(#spAccueil2)"
              />
              <path
                d="M0 14 C20 20 30 30 50 26 C70 22 80 12 100 18 C120 24 130 34 150 30 C170 26 185 34 200 38 C210 40 215 38 220 40"
                fill="none"
                stroke="#219EBC"
                strokeWidth="2"
              />
            </svg>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6E6E68' }}>
              <TrendingDown className="h-3.5 w-3.5" style={{ color: '#E56A00' }} />
              <b style={{ color: '#E56A00' }}>−10,25 %</b> vs semaine dernière
            </span>
          </div>
        </div>
      </section>

      {/* Emplacement d'accueil pour les blocs qui ne viennent pas de la
          maquette (aujourd'hui les alertes de validation) : rendus ICI plutôt
          qu'à côté du composant, pour hériter du fond, des gouttières et du
          même écart de 18px que les rangées ci-dessus. */}
      {children}
    </main>
  );
}
