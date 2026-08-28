"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { formatSolde } from "@/lib/finance";
import a from "./Accounting.module.css";

const MOIS_COURT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const FENETRE_MOIS = 6;

// Géométrie du tracé (repère du viewBox, pas des pixels écran).
const W = 300;
const H = 96;
const BORD_G = 4;
const BORD_D = 296;
const BORD_H = 8;
const BORD_B = 88;

const jour = 86400000;

function debutDeJour(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Construit la courbe de trésorerie à partir du journal comptable.
 *
 * Ce qui est tracé, c'est le SOLDE CUMULÉ jour par jour — pas le flux de
 * chaque écriture : la courbe explique ainsi le « Solde net » affiché
 * au-dessus d'elle, dont elle rejoint exactement la valeur à droite du trait
 * d'aujourd'hui. Les écritures antérieures à la fenêtre ne disparaissent pas :
 * elles forment le solde d'ouverture d'où part le tracé.
 *
 * Le trait vertical marque aujourd'hui, et le pointillé prolonge la courbe
 * jusqu'à la fin du mois en cours : rythme quotidien constaté depuis le début
 * du mois, plus les écritures déjà datées dans les jours à venir. C'est une
 * projection, d'où le pointillé — elle ne se lit pas comme du réalisé.
 */
function construireRapport(transactions, maintenant) {
  const aujourdhui = debutDeJour(maintenant);
  const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - (FENETRE_MOIS - 1), 1);
  // Dernier jour du mois en cours (jour 0 du mois suivant).
  const fin = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0);

  const libelles = Array.from({ length: FENETRE_MOIS }, (_, i) => {
    const d = new Date(debut.getFullYear(), debut.getMonth() + i, 1);
    return MOIS_COURT[d.getMonth()];
  });

  let ouverture = 0;
  const parJour = new Map();
  let futurDuMois = 0;
  let compteDansFenetre = 0;

  for (const t of transactions) {
    const d = debutDeJour(t.dateEffet);
    if (Number.isNaN(d.getTime())) continue;
    // Les écritures annulées restent comptées : leur écriture de compensation
    // (montant/type inversés) neutralise déjà leur effet, cf. /api/finance.
    const valeur = (t.type === "revenu" ? 1 : -1) * Number(t.montant);
    if (d < debut) {
      ouverture += valeur;
    } else if (d <= aujourdhui) {
      parJour.set(d.getTime(), (parJour.get(d.getTime()) ?? 0) + valeur);
      compteDansFenetre += 1;
    } else if (d <= fin) {
      // Déjà saisie, mais à échoir : elle nourrit la projection, pas le tracé.
      futurDuMois += valeur;
      compteDansFenetre += 1;
    }
  }

  // Un point par jour, du début de la fenêtre à aujourd'hui. On avance avec
  // setDate() et non en ajoutant 86 400 000 ms : au changement d'heure, un
  // « jour » ne fait pas 24 h, et le curseur cessait de tomber sur minuit
  // local — les écritures postérieures au passage à l'heure d'été n'étaient
  // alors plus retrouvées dans le regroupement par jour.
  const points = [];
  let cumul = ouverture;
  for (const curseur = new Date(debut); curseur <= aujourdhui; curseur.setDate(curseur.getDate() + 1)) {
    cumul += parJour.get(curseur.getTime()) ?? 0;
    points.push({ date: curseur.getTime(), solde: cumul });
  }
  if (points.length === 0) points.push({ date: aujourdhui.getTime(), solde: cumul });

  const soldeAujourdhui = cumul;

  // Projection : rythme quotidien du mois en cours × jours restants, plus les
  // écritures déjà datées d'ici la fin du mois.
  const debutMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  const joursEcoules = Math.max(1, Math.round((aujourdhui - debutMois) / jour) + 1);
  const joursRestants = Math.max(0, Math.round((fin - aujourdhui) / jour));
  // Solde à la VEILLE du mois : partir du solde du 1er inclurait déjà les
  // mouvements de ce jour-là, qui disparaîtraient donc du rythme.
  const iDebutMois = points.findIndex((p) => p.date >= debutMois.getTime());
  const soldeAvantMois = iDebutMois > 0 ? points[iDebutMois - 1].solde : ouverture;
  const rythme = (soldeAujourdhui - soldeAvantMois) / joursEcoules;
  const soldeProjete = soldeAujourdhui + rythme * joursRestants + futurDuMois;

  // Échelle verticale : bornée par les données (projection incluse), avec une
  // marge — on ne force pas le zéro, qui écraserait la courbe d'un solde élevé.
  const valeurs = points.map((p) => p.solde).concat(joursRestants > 0 ? [soldeProjete] : []);
  let min = Math.min(...valeurs);
  let max = Math.max(...valeurs);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const marge = (max - min) * 0.12;
  min -= marge;
  max += marge;

  const etendue = fin.getTime() - debut.getTime() || 1;
  const x = (t) => BORD_G + ((t - debut.getTime()) / etendue) * (BORD_D - BORD_G);
  const y = (v) => BORD_B - ((v - min) / (max - min)) * (BORD_B - BORD_H);

  const trace = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.solde).toFixed(1)}`)
    .join(" ");
  // L'aire descend jusqu'au zéro s'il est dans le cadre, sinon jusqu'au bas :
  // remplir sous une valeur négative jusqu'en bas donnerait à lire un volume
  // qui n'existe pas.
  const base = Math.min(BORD_B, Math.max(BORD_H, y(0)));
  const xDernier = x(points[points.length - 1].date);
  const aire = `${trace} L${xDernier.toFixed(1)} ${base.toFixed(1)} L${BORD_G} ${base.toFixed(1)} Z`;

  return {
    vide: compteDansFenetre === 0 && ouverture === 0,
    libelles,
    moisActif: FENETRE_MOIS - 1,
    trace,
    aire,
    xAujourdhui: xDernier,
    projection:
      joursRestants > 0
        ? { x1: xDernier, y1: y(soldeAujourdhui), x2: x(fin.getTime()), y2: y(soldeProjete) }
        : null,
    soldeAujourdhui,
    soldeProjete,
    joursRestants,
    debut,
    fin,
  };
}

export default function CashflowReport({ refreshToken = 0 }) {
  const [totaux, setTotaux] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/api/finance")
      .then((res) => {
        if (cancelled) return;
        setTotaux(res.totaux);
        setTransactions(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // Calculé seulement une fois le journal chargé : au premier rendu (serveur
  // comme hydratation) il n'y a pas de données, donc aucune date à comparer.
  const rapport = useMemo(
    () => (transactions ? construireRapport(transactions, new Date()) : null),
    [transactions],
  );

  const totalEntrees = totaux?.totalEntrees ?? 0;
  const totalSorties = totaux?.totalSorties ?? 0;
  const solde = totaux?.solde ?? 0;

  const periode = rapport
    ? `${rapport.debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} à ${rapport.fin.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`
    : "";

  return (
    <section className={a.card}>
      <div className={a.cardHead}>
        <div>
          <h2 className={a.cardTitle}>Rapport de trésorerie</h2>
          <p className={a.cardSub}>Entrées, sorties et solde net</p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className={a.statRow}>
        <div className={a.stat}>
          <span className={`${a.statIcon} ${a.statIconRevenue}`}>
            <TrendingUp size={16} strokeWidth={2.4} />
          </span>
          <div className={a.statText}>
            <div className={`${a.statValue} ${a.statValueRevenue}`}>{totalEntrees.toFixed(2)} DH</div>
            <div className={a.statLabel}>Total entrées</div>
          </div>
        </div>
        <div className={a.stat}>
          <span className={`${a.statIcon} ${a.statIconExpense}`}>
            <TrendingDown size={16} strokeWidth={2.4} />
          </span>
          <div className={a.statText}>
            <div className={`${a.statValue} ${a.statValueExpense}`}>{totalSorties.toFixed(2)} DH</div>
            <div className={a.statLabel}>Total sorties</div>
          </div>
        </div>
      </div>

      <div className={a.soldeBox}>
        <span className={a.soldeLabel}>Solde net</span>
        <span className={`${a.soldeValue} ${solde >= 0 ? a.statValueRevenue : a.statValueExpense}`}>
          {formatSolde(solde)}
        </span>
      </div>

      <div className={a.chartWrap}>
        {rapport && !rapport.vide ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className={a.chart}
              role="img"
              aria-label={`Évolution du solde de trésorerie de ${periode}. Solde aujourd'hui : ${formatSolde(rapport.soldeAujourdhui)}.${
                rapport.projection ? ` Projection à fin de mois : ${formatSolde(rapport.soldeProjete)}.` : ""
              }`}
            >
              <defs>
                <linearGradient id="mtCashFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFD100" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#FFD100" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={rapport.aire} fill="url(#mtCashFill)" />
              <path
                d={rapport.trace}
                fill="none"
                stroke="#E7B800"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {rapport.projection && (
                <>
                  {/* Aujourd'hui : à gauche le réalisé, à droite la projection. */}
                  <line
                    x1={rapport.xAujourdhui}
                    y1={BORD_H - 4}
                    x2={rapport.xAujourdhui}
                    y2={BORD_B + 4}
                    stroke="#202020"
                    strokeWidth="1"
                  />
                  <line
                    x1={rapport.projection.x1}
                    y1={rapport.projection.y1}
                    x2={rapport.projection.x2}
                    y2={rapport.projection.y2}
                    stroke="#C9A400"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                  />
                </>
              )}
            </svg>

            <div className={a.months}>
              {rapport.libelles.map((m, i) => (
                <span key={`${m}-${i}`} className={i === rapport.moisActif ? a.monthActive : a.month}>
                  {m}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className={a.chartEmpty}>
            {rapport ? "Aucune écriture sur les six derniers mois." : "Chargement du journal…"}
          </p>
        )}
      </div>
    </section>
  );
}
