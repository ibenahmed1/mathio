"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { formatSolde } from "@/lib/finance";
import a from "./Accounting.module.css";

const SERIES = [42, 30, 55, 34, 61, 40, 68, 47, 58, 36, 64, 44, 72, 50, 63, 41, 70, 52, 66, 45];
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun"];

export default function CashflowReport({ refreshToken = 0 }) {
  const [totaux, setTotaux] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/api/finance")
      .then((res) => {
        if (!cancelled) setTotaux(res.totaux);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const { line, area } = useMemo(() => {
    const w = 300, h = 96, n = SERIES.length;
    const pts = SERIES.map((v, i) => [
      (i / (n - 1)) * (w - 8) + 4,
      h - 8 - (v / 80) * (h - 18)
    ]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    return { line: d, area: `${d} L${w - 4} ${h - 4} L4 ${h - 4} Z` };
  }, []);

  const totalEntrees = totaux?.totalEntrees ?? 0;
  const totalSorties = totaux?.totalSorties ?? 0;
  const solde = totaux?.solde ?? 0;

  return (
    <section className={a.card}>
      <div className={a.cardHead}>
        <div>
          <h2 className={a.cardTitle}>Rapport de trésorerie</h2>
          <p className={a.cardSub}>Entrées, sorties et solde net</p>
        </div>
      </div>

      {error && <p className={a.formError}>{error}</p>}

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
        <svg viewBox="0 0 300 96" preserveAspectRatio="none" className={a.chart}>
          <defs>
            <linearGradient id="mtCashFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFD100" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#FFD100" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#mtCashFill)" />
          <path d={line} fill="none" stroke="#E7B800" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          <line x1="245" y1="4" x2="245" y2="92" stroke="#202020" strokeWidth="1" />
          <line x1="245" y1="40" x2="300" y2="40" stroke="#C9A400" strokeWidth="1" strokeDasharray="3 4" />
        </svg>

        <div className={a.months}>
          {MONTHS.map((m, i) => (
            <span key={m} className={i === 4 ? a.monthActive : a.month}>{m}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
