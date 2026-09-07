"use client";
// Mathio Dashboard (sans sidebar) — prêt à intégrer.
// Dépendances carte (optionnelle) : npm i d3 topojson-client
// Police : <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
import { useEffect, useRef, useState } from "react";
import s from "./Dashboard.module.css";

/* ===== Palette ===== */
const P = {
  bleuClair: "#8ECAE6", teal: "#209EBB", navy: "#023047", navy2: "#14526E",
  jaune: "#FFB701", orange: "#FC8500", orangeFonce: "#E56A00",
  btnJaune: "linear-gradient(180deg,#FFE14D,#FFD000)",
  btnNavy: "linear-gradient(135deg,#209EBB,#023047)",
};
const GRAD = {
  jaune: ["#FFB701", "#FC8500"],
  bleu: ["#8ECAE6", "#209EBB"],
  navy: ["#209EBB", "#023047"],
  orange: ["#FC8500", "#E56A00"],
};

/* ===== Styles de base (composition) ===== */
const cardTitle = { margin: 0, fontSize: 16, fontWeight: 700 };
const muted = { fontSize: 11, color: "#8C8C86" };
const kpiValue = { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" };

/* ===== Pilule statut : bordure + texte dégradés, fond blanc ===== */
function StatusPill({ label, grad }) {
  const [a, b] = grad;
  return (
    <span style={{ display: "inline-flex", padding: 1.5, borderRadius: 20, background: `linear-gradient(135deg,${a},${b})` }}>
      <span style={{ display: "inline-block", padding: "4px 11px", borderRadius: 20, background: "#FFF" }}>
        <span style={{ fontSize: 10, fontWeight: 700, background: `linear-gradient(135deg,${a},${b})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{label}</span>
      </span>
    </span>
  );
}

/* ===== Données ===== */
const commandes = [
  { bon: "45453", client: "Cherif Douas", ville: "Alger", prix: "9 900 DA", statut: "En cours", grad: GRAD.jaune },
  { bon: "86453", client: "Rasel Khandaker", ville: "Oran", prix: "12 000 DA", statut: "Ouvert", grad: GRAD.bleu },
  { bon: "58983", client: "Micel Adre", ville: "Sétif", prix: "10 000 DA", statut: "Livré", grad: GRAD.navy },
  { bon: "85637", client: "Isken Colum", ville: "Blida", prix: "8 900 DA", statut: "En cours", grad: GRAD.jaune },
  { bon: "41572", client: "Hangai Merad", ville: "Annaba", prix: "20 000 DA", statut: "Retour", grad: GRAD.orange },
];
const zones = [
  { nom: "Alger", valeur: "10,6k", taux: "0,6 % ▲", couleur: "#FFB701", tcolor: "#1B7F98" },
  { nom: "Oran", valeur: "6,2k", taux: "2,3 % ▲", couleur: "#FC8500", tcolor: "#1B7F98" },
  { nom: "Sétif", valeur: "5,3k", taux: "0,1 % ▼", couleur: "#219EBC", tcolor: "#E56A00" },
  { nom: "Blida", valeur: "5,1k", taux: "1,8 % ▲", couleur: "#1B7F98", tcolor: "#1B7F98" },
  { nom: "Annaba", valeur: "3,9k", taux: "3 % ▼", couleur: "#FC8500", tcolor: "#E56A00" },
  { nom: "Constantine", valeur: "2,2k", taux: "5,2 % ▲", couleur: "#34342F", tcolor: "#1B7F98" },
];
const activites = [
  { titre: "Tâche mise à jour", temps: "42 min", qui: "Karim", action: "a mis à jour une tournée" },
  { titre: "Colis ajouté", temps: "1 h", qui: "Sara", action: "a créé 12 nouveaux colis" },
  { titre: "Bon de livraison publié", temps: "2 h", qui: "Yacine", action: "a validé le bon BL-5893" },
  { titre: "Nouvelle tâche", temps: "3 h", qui: "Amine", action: "a planifié une tournée" },
  { titre: "Commentaire répondu", temps: "5 h", qui: "Lina", action: "a répondu au client" },
];
const barres = [
  [90, 60, 140], [70, 50, 120], [110, 85, 160], [75, 100, 145], [55, 90, 130], [95, 65, 150], [45, 80, 125],
];

export default function Dashboard() {
  const [tab, setTab] = useState("MOIS");
  const mapRef = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [d3, topojson] = await Promise.all([import("d3"), import("topojson-client")]);
        const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
        const topo = await res.json();
        if (dead || !mapRef.current) return;
        const countries = topojson.feature(topo, topo.objects.countries);
        const el = mapRef.current;
        const w = el.clientWidth || 700, h = el.clientHeight || 320;
        const proj = d3.geoNaturalEarth1().fitSize([w, h], countries);
        const path = d3.geoPath(proj);
        const colors = { "012": "#FFB701", "250": "#219EBC", "504": "#FC8500", "788": "#FC8500", "724": "#023047", "380": "#14526E" };
        const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).style("width", "100%").style("height", "100%");
        svg.selectAll("path").data(countries.features).join("path")
          .attr("d", path).attr("fill", (f) => colors[f.id] || "#E8E8E5")
          .attr("stroke", "#FFF").attr("stroke-width", 0.5);
        el.innerHTML = ""; el.appendChild(svg.node());
      } catch { /* carte indisponible : fond neutre */ }
    })();
    return () => { dead = true; };
  }, []);

  const tabStyle = (t) => ({
    border: "none", fontFamily: "inherit", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
    ...(tab === t ? { background: P.btnNavy, color: "#FFF" } : { background: "transparent", color: "#8C8C86" }),
  });

  return (
    <main className={s.main}>
      {/* ===== Cadrans KPI (ordre de la palette) ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: "linear-gradient(135deg,#8ECAE6,#209EBB)", color: P.navy }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Revenus</span>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={kpiValue}>432 500 DA</span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>01 fév - 10 mars</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none"><g stroke="rgba(2,48,71,0.6)" strokeWidth="3" strokeLinecap="round"><path d="M3 30V18" /><path d="M11 30V10" /><path d="M19 30V22" /><path d="M27 30V6" /><path d="M35 30V14" /><path d="M43 30V20" /><path d="M51 30V4" /></g></svg>
          </div>
        </div>
        <div className={s.kpi} style={{ background: "linear-gradient(135deg,#209EBB,#023047)", color: "#FFF" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: P.jaune }}>Colis traités</span>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={kpiValue}>60 236</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>01 fév - 10 mars</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none"><path d="M2 26 C10 26 12 8 20 12 C28 16 30 28 38 22 C46 16 48 6 56 8" stroke={P.jaune} strokeWidth="2.4" strokeLinecap="round" fill="none" /></svg>
          </div>
        </div>
        <div className={s.kpi} style={{ background: "linear-gradient(135deg,#023047,#14526E)", color: "#FFF" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Taux de retour</span>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={kpiValue}>4,2 %</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>01 fév - 10 mars</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none"><path d="M2 18 C8 10 12 26 18 20 C24 14 28 24 34 16 C40 8 44 22 50 14 C53 10 55 12 56 10" stroke="rgba(255,255,255,0.85)" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
          </div>
        </div>
        <div className={s.kpi} style={{ background: "linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)", color: P.navy }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Encaissements</span>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={kpiValue}>318 900 DA</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>01 fév - 10 mars</span>
            </div>
            <svg width="58" height="34" viewBox="0 0 58 34" fill="none"><g stroke="rgba(2,48,71,0.55)" strokeWidth="3" strokeLinecap="round"><path d="M3 30V20" /><path d="M11 30V8" /><path d="M19 30V24" /><path d="M27 30V12" /><path d="M35 30V18" /><path d="M43 30V6" /><path d="M51 30V16" /></g></svg>
          </div>
        </div>
      </section>

      {/* ===== Graphe principal + Trafic ===== */}
      <section className={s.row2}>
        <div className={`${s.card} ${s.chartCard}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <h2 style={cardTitle}>Tableau de bord</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#F6F6F5", borderRadius: 8, padding: 3 }}>
              {["JOUR", "SEMAINE", "MOIS"].map((t) => (
                <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>{t}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: "#6E6E68" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFD000" }} />Livré</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#219EBC" }} />Retour</span>
            </div>
          </div>
          <div className={s.chartBody}>
            <div className={s.chartStats}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>646 896 DA</span>
                <span style={muted}>Revenus du mois en cours</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>82</span>
                <span style={muted}>Ventes du mois en cours</span>
              </div>
              <button className={s.btnYellow} style={{ alignSelf: "flex-start", border: "none", background: P.btnJaune, color: "#1A1A18", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "10px 16px", borderRadius: 8, cursor: "pointer", marginTop: 4, boxShadow: "0 2px 6px rgba(255,208,0,0.45)" }}>
                Résumé du mois dernier
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "flex-end" }}>
              <svg viewBox="0 0 600 200" preserveAspectRatio="none" style={{ width: "100%", height: 200, display: "block" }}>
                <defs>
                  <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFB701" stopOpacity="0.55" /><stop offset="100%" stopColor="#FFB701" stopOpacity="0" /></linearGradient>
                  <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8ECAE6" stopOpacity="0.55" /><stop offset="100%" stopColor="#8ECAE6" stopOpacity="0" /></linearGradient>
                </defs>
                <g stroke="#F2F2EF" strokeWidth="1"><path d="M0 40H600" /><path d="M0 80H600" /><path d="M0 120H600" /><path d="M0 160H600" /></g>
                <path d="M0 160 C50 140 80 90 120 105 C160 120 190 55 240 65 C290 75 310 135 360 115 C410 95 440 45 490 75 C530 98 560 85 600 110 V200 H0 Z" fill="url(#gB)" />
                <path d="M0 160 C50 140 80 90 120 105 C160 120 190 55 240 65 C290 75 310 135 360 115 C410 95 440 45 490 75 C530 98 560 85 600 110" fill="none" stroke="#219EBC" strokeWidth="2" />
                <path d="M0 175 C55 160 85 120 130 132 C175 144 205 85 255 95 C305 105 325 155 375 140 C425 125 455 80 505 105 C545 124 570 112 600 132 V200 H0 Z" fill="url(#gA)" />
                <path d="M0 175 C55 160 85 120 130 132 C175 144 205 85 255 95 C305 105 325 155 375 140 C425 125 455 80 505 105 C545 124 570 112 600 132" fill="none" stroke="#FFD000" strokeWidth="2.2" />
              </svg>
            </div>
          </div>
          <div className={s.chartFooter}>
            {[
              { label: "Solde portefeuille", val: "356 780 DA", bg: "#FFB701", fg: "#1A1A18" },
              { label: "Frais de livraison", val: "158 953 DA", bg: "#FFF3D1", fg: "#9A6E00" },
              { label: "Ventes estimées", val: "265 150 DA", bg: "#E4F2F9", fg: "#14708A" },
            ].map((it) => (
              <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: it.bg, color: it.fg, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 34px", fontWeight: 700, fontSize: 13 }}>◆</span>
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <span style={muted}>{it.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{it.val}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`${s.card} ${s.trafficCard}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={cardTitle}>Trafic</h2>
            <button style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #E8E8E5", background: "#FFF", borderRadius: 8, padding: "6px 10px", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: "#6E6E68", cursor: "pointer" }}>MENSUEL ▾</button>
          </div>
          <div style={{ position: "relative", alignSelf: "center", width: 190, height: 190, marginTop: 6 }}>
            <svg viewBox="0 0 190 190" style={{ width: 190, height: 190, transform: "rotate(-90deg)" }}>
              <defs>
                <linearGradient id="tg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8ECAE6" /><stop offset="100%" stopColor="#209EBB" /></linearGradient>
                <linearGradient id="tg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#209EBB" /><stop offset="100%" stopColor="#023047" /></linearGradient>
                <linearGradient id="tg3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#FFE14D" /><stop offset="100%" stopColor="#FFD000" /></linearGradient>
              </defs>
              <circle cx="95" cy="95" r="76" fill="none" stroke="#F2F2EF" strokeWidth="18" />
              <circle cx="95" cy="95" r="76" fill="none" stroke="url(#tg1)" strokeWidth="18" strokeLinecap="round" strokeDasharray="262.6 477.5" strokeDashoffset="0" />
              <circle cx="95" cy="95" r="76" fill="none" stroke="url(#tg2)" strokeWidth="18" strokeLinecap="round" strokeDasharray="157.6 477.5" strokeDashoffset="-267.6" />
              <circle cx="95" cy="95" r="76" fill="none" stroke="url(#tg3)" strokeWidth="18" strokeLinecap="round" strokeDasharray="52.3 477.5" strokeDashoffset="-430.2" />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
              <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>1,56k</span>
              <span style={muted}>Visiteurs totaux</span>
            </div>
          </div>
          <div className={s.trafficLegend}>
            {[
              { label: "E-commerce", val: "55 %", grad: "linear-gradient(90deg,#8ECAE6,#209EBB)" },
              { label: "Boutique", val: "33 %", grad: "linear-gradient(90deg,#209EBB,#023047)" },
              { label: "Direct", val: "12 %", grad: "linear-gradient(90deg,#FFE14D,#FFD000)" },
            ].map((it) => (
              <div key={it.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 4px 12px", borderBottom: "3px solid transparent", borderImage: `${it.grad} 1` }}>
                <span style={muted}>{it.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{it.val}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Activités + Statut des commandes ===== */}
      <section className={s.row3}>
        <div className={s.card} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ ...cardTitle, marginBottom: 14 }}>Activités récentes</h2>
          {activites.map((a) => (
            <div key={a.titre} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: "1px solid #F4F4F1" }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid #E8E8E5", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 34px", color: "#3A3A36", fontSize: 13 }}>●</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.3 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.titre}</span>
                <span style={{ fontSize: 11, color: "#A3A39C" }}>Il y a {a.temps} · <b style={{ color: "#6E6E68" }}>{a.qui}</b> {a.action}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={s.card} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h2 style={cardTitle}>Statut des commandes</h2>
              <span style={muted}>Aperçu du dernier mois</span>
            </div>
            <button className={s.btnNavy} style={{ display: "flex", alignItems: "center", gap: 7, border: "none", background: P.btnNavy, color: "#FFF", borderRadius: 8, padding: "9px 14px", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + Ajouter facture
            </button>
          </div>
          <div className={s.tableWrap}>
            <div className={s.table}>
              {["BON", "CLIENT", "WILAYA", "PRIX", "STATUT"].map((h, i, arr) => (
                <span key={h} style={{ background: "#F6F6F5", padding: "10px 12px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#8C8C86", borderRadius: i === 0 ? "8px 0 0 8px" : i === arr.length - 1 ? "0 8px 8px 0" : 0 }}>{h}</span>
              ))}
              {commandes.map((c) => (
                <div key={c.bon} style={{ display: "contents" }}>
                  <span style={{ padding: "13px 12px", borderBottom: "1px solid #F4F4F1", fontWeight: 600 }}>{c.bon}</span>
                  <span style={{ padding: "13px 12px", borderBottom: "1px solid #F4F4F1", color: "#4A4A45" }}>{c.client}</span>
                  <span style={{ padding: "13px 12px", borderBottom: "1px solid #F4F4F1", color: "#8C8C86" }}>{c.ville}</span>
                  <span style={{ padding: "13px 12px", borderBottom: "1px solid #F4F4F1", fontWeight: 600 }}>{c.prix}</span>
                  <span style={{ padding: "9px 12px", borderBottom: "1px solid #F4F4F1" }}><StatusPill label={c.statut} grad={c.grad} /></span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "auto" }}>
            <span style={muted}>Affichage de 1 à 5 sur 20 entrées</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {["‹", "1", "2", "3", "4", "›"].map((p) => (
                <button key={p} style={{ width: 26, height: 26, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 12, ...(p === "2" ? { background: P.btnJaune, color: "#1A1A18", fontWeight: 700 } : { background: "transparent", color: "#4A4A45" }) }}>{p}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Zones clients + Carte ===== */}
      <section className={s.row4}>
        <div className={s.card} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={cardTitle}>Principales zones clients</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>15 870</span>
            <span style={muted}>La plupart des clients sont à Alger</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            {zones.map((z) => (
              <div key={z.nom} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderBottom: "1px solid #F4F4F1", fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: z.couleur, flex: "0 0 8px" }} />
                <span style={{ flex: 1, color: "#4A4A45", fontWeight: 500 }}>{z.nom}</span>
                <span style={{ fontWeight: 700 }}>{z.valeur}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: z.tcolor, width: 44, textAlign: "right" }}>{z.taux}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={s.card} style={{ padding: 14, position: "relative", minHeight: 340 }}>
          <div ref={mapRef} style={{ position: "absolute", inset: 14, display: "flex", alignItems: "center", justifyContent: "center" }} />
        </div>
      </section>

      {/* ===== Vue d'ensemble + Sparklines ===== */}
      <section className={s.row5}>
        <div className={s.card} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <h2 style={cardTitle}>Vue d&apos;ensemble</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#6E6E68" }}>
              {[
                ["Livré", "linear-gradient(135deg,#FFEB99,#FFD84D)"],
                ["En cours", "linear-gradient(135deg,#C9E7F5,#8ECAE6)"],
                ["Annulé", "linear-gradient(135deg,#FFD1A3,#FFB701)"],
              ].map(([l, g]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: g }} />{l}</span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 10, color: "#A3A39C", textAlign: "right", paddingBottom: 22 }}>
              <span>20k</span><span>15k</span><span>10k</span><span>5k</span><span>1k</span><span>0</span>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <svg viewBox="0 0 640 220" preserveAspectRatio="none" style={{ width: "100%", height: 220, display: "block" }}>
                <defs>
                  <linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFEB99" /><stop offset="100%" stopColor="#FFD84D" /></linearGradient>
                  <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C9E7F5" /><stop offset="100%" stopColor="#8ECAE6" /></linearGradient>
                  <linearGradient id="bg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFD1A3" /><stop offset="100%" stopColor="#FFB701" /></linearGradient>
                </defs>
                <g stroke="#F2F2EF" strokeWidth="1">{[0, 44, 88, 132, 176, 220].map((y) => <path key={y} d={`M0 ${y}H640`} />)}</g>
                <g>
                  {barres.map(([a, b, c], i) => {
                    const x = 30 + i * 90;
                    return (
                      <g key={i}>
                        <rect x={x} y={220 - (220 - a)} width="9" height={220 - a} rx="4" fill="url(#bg1)" />
                        <rect x={x + 13} y={b} width="9" height={220 - b} rx="4" fill="url(#bg2)" />
                        <rect x={x + 26} y={c} width="9" height={220 - c} rx="4" fill="url(#bg3)" />
                      </g>
                    );
                  })}
                </g>
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#A3A39C", padding: "6px 24px 0" }}>
                <span>Jan</span><span>Fév</span><span>Mar</span><span>Avr</span><span>Mai</span><span>Juin</span><span>Juil</span>
              </div>
            </div>
          </div>
        </div>

        <div className={s.sparkCol}>
          <div className={s.card} style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6E6E68" }}>Revenu total</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>2 509 640 DA</span>
            <svg viewBox="0 0 220 46" preserveAspectRatio="none" style={{ width: "100%", height: 46 }}>
              <defs><linearGradient id="sp1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFB701" stopOpacity="0.5" /><stop offset="100%" stopColor="#FFB701" stopOpacity="0" /></linearGradient></defs>
              <path d="M0 36 C20 30 30 16 50 20 C70 24 80 34 100 26 C120 18 130 8 150 14 C170 20 185 10 200 6 C210 3 215 5 220 4 V46 H0 Z" fill="url(#sp1)" />
              <path d="M0 36 C20 30 30 16 50 20 C70 24 80 34 100 26 C120 18 130 8 150 14 C170 20 185 10 200 6 C210 3 215 5 220 4" fill="none" stroke="#FC8500" strokeWidth="2" />
            </svg>
            <span style={{ fontSize: 11, color: "#6E6E68" }}><b style={{ color: "#1B7F98" }}>▲ +12,08 %</b> vs semaine dernière</span>
          </div>
          <div className={s.card} style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6E6E68" }}>Dépenses totales</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>183 000 DA</span>
            <svg viewBox="0 0 220 46" preserveAspectRatio="none" style={{ width: "100%", height: 46 }}>
              <defs><linearGradient id="sp2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8ECAE6" stopOpacity="0.5" /><stop offset="100%" stopColor="#8ECAE6" stopOpacity="0" /></linearGradient></defs>
              <path d="M0 14 C20 20 30 30 50 26 C70 22 80 12 100 18 C120 24 130 34 150 30 C170 26 185 34 200 38 C210 40 215 38 220 40 V46 H0 Z" fill="url(#sp2)" />
              <path d="M0 14 C20 20 30 30 50 26 C70 22 80 12 100 18 C120 24 130 34 150 30 C170 26 185 34 200 38 C210 40 215 38 220 40" fill="none" stroke="#219EBC" strokeWidth="2" />
            </svg>
            <span style={{ fontSize: 11, color: "#6E6E68" }}><b style={{ color: "#E56A00" }}>▼ −10,25 %</b> vs semaine dernière</span>
          </div>
        </div>
      </section>
    </main>
  );
}
