"use client";

/**
 * BON DE DISTRIBUTION — CRÉER · UI SEULE (présentational)
 * ------------------------------------------------------------------
 * Aucune logique métier ici : pas de filtrage, pas de calcul de statut,
 * pas d'appel API. Le composant ne fait que RENDRE ce qu'on lui passe
 * et REMONTER les intentions de l'utilisateur via des callbacks.
 *
 * La SIDEBAR n'est pas incluse (composant séparé de votre app).
 * Contraintes visuelles pour la colonne de gauche, si utile :
 *   - largeur 246px, fond #F7F7F4, bordure droite 1px #EAE8DE, padding 20px 14px
 *   - item actif : fond linear-gradient(135deg,#FFEE32,#FFD100), texte #3f2f00, radius 12px
 *   - item inactif : texte #5e605e, hover fond rgba(255,209,0,.14)
 *
 * Props (toutes optionnelles, tout est piloté depuis l'extérieur) :
 *   codeBD              string | null      — null → affiche « code à l'impression »
 *   statutLabel         string             — ex. "Nouveau" | "En cours"
 *   statutTone          "warn" | "ok"      — jaune / vert
 *   etape               "zone" | "tournee" — quelle vue afficher
 *   zones               [{ id, nom, nbColis, nbLivreurs, ratio }]  ratio 0–1 pour la barre
 *   zone                { nom } | null
 *   livreurs            [{ id, nom, initiales, ligneSecondaire, compteur, selected }]
 *   livreurCompteur     string            — ex. "6/7"
 *   rechercheLivreur    string
 *   colis               [{ id, code, client, ville, quartier, crbt }]
 *   colisCompteur       string            — ex. "25 / 128"
 *   rechercheColis      string
 *   filtres             [{ id, label, actif }]
 *   resteAAfficher      number            — 0 → pas de bouton « afficher plus »
 *   bon                 [{ id, code, ligneSecondaire, crbt }]
 *   totaux              [{ label, value }]
 *   scanValue           string
 *   scanVisible         boolean
 *   message             string | null     — bandeau d'info sous le scan
 *   journal             [{ id, heure, texte }]
 *   confirmation        { ouverte, titre, sousTitre, totaux[], texte } | null
 *
 * Callbacks : onZonePick(id) onZoneChange() onLivreurPick(id)
 *   onRechercheLivreur(v) onRechercheColis(v) onFiltrePick(id)
 *   onColisAdd(id) onColisRemove(id) onAfficherPlus() onAjouterFiltre()
 *   onDropColis(colisId, index|null) onReorder(colisId, index)
 *   onScanChange(v) onScanSubmit() onValider() onReset()
 *   onConfirmer() onAnnuler()
 */

import { useState } from "react";

const C = {
  jaune: "#FFD100",
  jauneClair: "#FFEE32",
  grad: "linear-gradient(135deg,#FFEE32 0%,#FFD100 100%)",
  encre: "#202020",
  encre2: "#3f413f",
  encre3: "#5e605e",
  muted: "#6b6d6b",
  muted2: "#8d8f8c",
  muted3: "#9a9c9a",
  ligne: "#EAE8DE",
  ligne2: "#F1EFE6",
  ligne3: "#EEECE2",
  surface: "#FFFFFF",
  surface2: "#F7F7F4",
  fontStack: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
};

const S = {
  // NB : le `padding` de <main>, ainsi que toutes les grilles de mise en page
  // (S n'en porte aucune), vivent dans la feuille `css` injectée plus bas et
  // non ici — un style inline gagne toujours contre une media query, donc
  // toute propriété qui doit varier avec la largeur d'écran ne peut pas être
  // déclarée dans cet objet.
  main: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    fontFamily: C.fontStack,
    color: C.encre,
    backgroundColor: C.surface,
    backgroundImage:
      "radial-gradient(680px 420px at 12% -8%, rgba(255,209,0,.30), rgba(255,209,0,0) 62%)," +
      "radial-gradient(560px 380px at 88% -4%, rgba(255,238,50,.26), rgba(255,238,50,0) 60%)," +
      "radial-gradient(900px 520px at 60% 108%, rgba(255,209,0,.10), rgba(255,209,0,0) 65%)",
  },
  kicker: { fontSize: 10.5, fontWeight: 800, letterSpacing: 1.3, color: "#9a8213" },
  label: { fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, color: C.muted },
  chip: {
    fontSize: 12,
    fontWeight: 800,
    color: C.encre2,
    background: "rgba(255,255,255,.75)",
    border: `1px solid ${C.ligne}`,
    borderRadius: 20,
    padding: "5px 12px",
    fontVariantNumeric: "tabular-nums",
  },
  card: {
    background: "rgba(255,255,255,.82)",
    border: `1px solid ${C.ligne}`,
    borderRadius: 20,
    boxShadow: "0 2px 10px rgba(32,32,32,.05)",
    overflow: "hidden",
  },
  input: {
    border: "none",
    background: "transparent",
    outline: "none",
    fontSize: 12,
    color: C.encre2,
    width: "100%",
    fontFamily: "inherit",
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: C.surface,
    border: `1px solid ${C.ligne}`,
    borderRadius: 11,
    padding: "7px 10px",
  },
  btnGhost: {
    border: `1px solid ${C.ligne}`,
    background: "rgba(255,255,255,.8)",
    color: C.encre2,
    fontSize: 12.5,
    fontWeight: 700,
    borderRadius: 12,
    padding: "10px 15px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnPrimary: {
    border: "none",
    background: C.grad,
    color: "#3f2f00",
    fontSize: 12.5,
    fontWeight: 800,
    borderRadius: 12,
    padding: "11px 18px",
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(255,209,0,.36)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "inherit",
  },
  avatar: {
    borderRadius: 11,
    background: C.grad,
    color: "#3f2f00",
    fontWeight: 800,
    display: "grid",
    placeItems: "center",
    flex: "none",
  },
  num: { fontVariantNumeric: "tabular-nums" },
};

// Feuille injectée par le composant : animations + TOUTE la mise en page qui
// doit réagir à la largeur d'écran. Les grilles ne peuvent pas rester en style
// inline — une media query ne peut pas battre un attribut `style`, et l'écran
// est utilisé aussi bien sur poste fixe au bureau que sur tablette/téléphone
// au quai (web app Planner, § /planner/bons-distribution/creer).
const css = `
@keyframes bdFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes bdIn { from { opacity: 0; transform: translateY(14px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes bdSlide { from { opacity: 0; transform: translateX(12px) } to { opacity: 1; transform: none } }
@keyframes bdPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,209,0,.55) } 50% { box-shadow: 0 0 0 7px rgba(255,209,0,0) } }

.bd-main { padding: 20px 24px 26px; }

/* Le repli est piloté par la largeur RÉELLE du wizard, pas par celle de la
   fenêtre : la sidebar de l'espace (admin ou Planner) lui prend ~280px, une
   media query sur le viewport se tromperait donc de cette largeur sur poste
   fixe — et de rien du tout sur téléphone, où la sidebar est masquée. Un
   conteneur de requête donne le bon seuil dans les deux cas. Le repli
   @supports plus bas couvre les navigateurs sans container queries.
   Le conteneur est posé ICI, sur le bloc des étapes, et surtout PAS sur
   <main> : container-type implique "contain: layout", ce qui ferait du
   porteur le bloc conteneur des descendants "position: fixed" — la modale de
   confirmation, qui est un frère de ce bloc, se retrouverait cadrée sur le
   wizard au lieu de l'écran. */
.bd-etapes { display: flex; flex-direction: column; gap: 14px; container-type: inline-size; }

/* Actions d'en-tête (Réinitialiser / Valider) : collées à droite tant qu'il y
   a la place, pleine largeur ensuite. */
.bd-actions { margin-left: auto; display: flex; align-items: center; gap: 9px; flex: none; }

/* Étape 1 — cartes de zone. Le min() évite qu'une carte de 268px déborde d'un
   écran de 320px : elle ne descend jamais sous la largeur disponible. */
.bd-zones { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(268px, 100%), 1fr)); gap: 12px; }

/* Étapes 2 & 3 — colonne livreurs + poste de travail. */
.bd-split { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
.bd-livreurs { max-height: 392px; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

/* Poste de travail — colis éligibles à gauche, bon en cours à droite. */
.bd-workspace { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; align-items: start; min-width: 0; }

.bd-ligne-colis { display: grid; grid-template-columns: 16px minmax(0, 1.15fr) minmax(0, 1fr) auto 30px; gap: 10px; align-items: center; padding: 10px 15px; border-bottom: 1px solid #F5F3EA; cursor: grab; }

/* Le padding de <main> ne peut pas venir d'une @container (une requête de
   conteneur ne peut pas styler son propre conteneur) : il reste sur le
   viewport, où la sidebar ne change rien à la marge à réserver au doigt. */
@media (max-width: 640px) {
  .bd-main { padding: 14px 14px 20px; }
  .bd-actions { margin-left: 0; width: 100%; }
  .bd-actions > button { flex: 1 1 auto; justify-content: center; }
}

/* Les seuils sont exprimés sur le conteneur (largeur totale du wizard), mais
   ce qu'ils protègent, c'est la largeur du PANNEAU COLIS — qui vaut le
   conteneur moins la colonne livreurs (300px + 14px de gouttière) tant que
   .bd-split est en deux colonnes, puis le conteneur entier ensuite. D'où des
   seuils décalés de ces ~314px plutôt que des nombres ronds. */

/* Les deux panneaux du poste de travail se superposent dès qu'ils ne tiennent
   plus côte à côte sans devenir illisibles — le bon reste alors sous la liste
   des colis, dans l'ordre de lecture du geste (je choisis, puis j'ajoute).
   1080 = 314 (colonne livreurs) + ~766 pour les deux panneaux. */
@container (max-width: 1080px) {
  .bd-workspace { grid-template-columns: minmax(0, 1fr); }
}

/* Tablette : la colonne des livreurs passe au-dessus du poste de travail et
   sa hauteur est réduite pour ne pas repousser le travail sous la ligne de
   flottaison. */
@container (max-width: 760px) {
  .bd-split { grid-template-columns: minmax(0, 1fr); }
  .bd-livreurs { max-height: 260px; }
}

/* Téléphone : une ligne de colis passe sur deux rangées — identité puis ville
   à gauche, CRBT et bouton d'ajout calés à droite sur toute la hauteur. La
   poignée de glisser disparaît : le drag & drop HTML5 ne fonctionne pas au
   doigt, l'ajout se fait par le bouton « + » (ou le double-tap). */
@container (max-width: 620px) {
  .bd-ligne-colis { grid-template-columns: minmax(0, 1fr) auto 32px; column-gap: 10px; row-gap: 2px; padding: 10px 12px; }
  .bd-ligne-colis > .bd-grip { display: none; }
  .bd-ligne-colis > .bd-colis-identite { grid-column: 1; grid-row: 1; }
  .bd-ligne-colis > .bd-colis-lieu { grid-column: 1; grid-row: 2; }
  .bd-ligne-colis > .bd-colis-crbt { grid-column: 2; grid-row: 1 / span 2; align-self: center; text-align: right; }
  .bd-ligne-colis > .bd-colis-ajout { grid-column: 3; grid-row: 1 / span 2; align-self: center; }
}

/* Repli sans container queries : mêmes seuils, majorés de la largeur de la
   sidebar (~280px) plus les marges de la coquille, puisqu'on mesure alors la
   fenêtre entière. Approximatif par construction — c'est précisément ce que
   les @container ci-dessus évitent quand le navigateur les gère. */
@supports not (container-type: inline-size) {
  @media (max-width: 1410px) {
    .bd-workspace { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 1090px) {
    .bd-split { grid-template-columns: minmax(0, 1fr); }
    .bd-livreurs { max-height: 260px; }
  }
  @media (max-width: 660px) {
    .bd-ligne-colis { grid-template-columns: minmax(0, 1fr) auto 32px; column-gap: 10px; row-gap: 2px; padding: 10px 12px; }
    .bd-ligne-colis > .bd-grip { display: none; }
    .bd-ligne-colis > .bd-colis-identite { grid-column: 1; grid-row: 1; }
    .bd-ligne-colis > .bd-colis-lieu { grid-column: 1; grid-row: 2; }
    .bd-ligne-colis > .bd-colis-crbt { grid-column: 2; grid-row: 1 / span 2; align-self: center; text-align: right; }
    .bd-ligne-colis > .bd-colis-ajout { grid-column: 3; grid-row: 1 / span 2; align-self: center; }
  }
}
`;

export default function BonDistributionCreerUI({
  codeBD = null,
  statutLabel = "Nouveau",
  statutTone = "warn",
  etape = "zone",
  zones = [],
  zone = null,
  livreurs = [],
  livreurCompteur = "",
  rechercheLivreur = "",
  livreurNom = "",
  colis = [],
  colisCompteur = "",
  rechercheColis = "",
  filtres = [],
  resteAAfficher = 0,
  bon = [],
  totaux = [],
  scanValue = "",
  scanVisible = true,
  message = null,
  journal = [],
  confirmation = null,
  onZonePick,
  onZoneChange,
  onLivreurPick,
  onRechercheLivreur,
  onRechercheColis,
  onFiltrePick,
  onColisAdd,
  onColisRemove,
  onAfficherPlus,
  onAjouterFiltre,
  onDropColis,
  onReorder,
  onScanChange,
  onScanSubmit,
  onValider,
  onReset,
  onConfirmer,
  onAnnuler,
}) {
  // état PUREMENT visuel (survol / cible de drop) — aucune règle métier
  const [dropActif, setDropActif] = useState(false);
  const [indexCible, setIndexCible] = useState(null);
  const [source, setSource] = useState(null);

  const tone =
    statutTone === "ok"
      ? { color: "#4d7a34", background: "rgba(120,170,90,.16)", border: "1px solid rgba(120,170,90,.28)" }
      : { color: "#8a7405", background: "rgba(255,209,0,.22)", border: "1px solid rgba(255,209,0,.45)" };

  const finDrag = () => {
    setDropActif(false);
    setIndexCible(null);
    setSource(null);
  };

  return (
    <main className="bd-main" style={S.main}>
      <style>{css}</style>

      {/* EN-TÊTE : kicker + code + statut + actions (pas de titre, pas de stepper) */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={S.kicker}>BONS DE DISTRIBUTION · CRÉER</div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 8, flexWrap: "wrap" }}>
            <span style={S.chip}>{codeBD || "Code attribué à l'impression"}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, borderRadius: 20, padding: "5px 12px", ...tone }}>
              ● {statutLabel.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="bd-actions">
          <button type="button" style={S.btnGhost} onClick={onReset}>Réinitialiser</button>
          <button type="button" style={S.btnPrimary} onClick={onValider}>
            <span>🖨</span><span>Valider &amp; imprimer</span>
          </button>
        </div>
      </div>

      {/* ÉTAPE 1 — ZONE : cartes, volume au hub, barre comparative */}
      {etape === "zone" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "bdFade .22s ease both" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={S.label}>ÉTAPE 1 · ZONE DE DISTRIBUTION</span>
            <span style={{ fontSize: 11.5, color: C.muted2 }}>Choisissez la zone : la suite s'y limite.</span>
          </div>
          <div className="bd-zones">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => onZonePick && onZonePick(z.id)}
                style={{
                  textAlign: "left",
                  fontFamily: "inherit",
                  color: "inherit",
                  background: "rgba(255,255,255,.85)",
                  border: `1.5px solid ${C.ligne}`,
                  borderRadius: 18,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(32,32,32,.05)",
                  transition: "transform .16s ease, border-color .16s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E7B800"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.ligne; e.currentTarget.style.transform = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <div style={{ ...S.avatar, width: 38, height: 38, borderRadius: 13 }}>
                    <ion-icon name="location-outline" style={{ fontSize: 20 }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: -0.2 }}>{z.nom}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2 }}>
                      {z.nbLivreurs} livreurs actifs
                    </div>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right", flex: "none" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5, ...S.num }}>{z.nbColis}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.7, color: C.muted3 }}>AU HUB</div>
                  </div>
                </div>
                <div style={{ height: 6, borderRadius: 6, background: "rgba(32,32,32,.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((z.ratio || 0) * 100)}%`, background: C.grad, borderRadius: 6 }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ÉTAPES 2 & 3 */}
      {etape !== "zone" && (
        <div className="bd-etapes">
          {/* bandeau de contexte zone */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.encre, borderRadius: 16, padding: "11px 14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.1, color: C.jaune }}>ZONE</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF" }}>{zone?.nom}</span>
            <button
              type="button"
              onClick={onZoneChange}
              style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,.22)", background: "rgba(255,255,255,.06)", color: "#EDEBE2", fontSize: 11.5, fontWeight: 700, borderRadius: 10, padding: "7px 12px", cursor: "pointer", fontFamily: "inherit" }}
            >
              Changer de zone
            </button>
          </div>

          <div className="bd-split">
            {/* ÉTAPE 2 — LIVREUR : colonne compacte + recherche */}
            <section style={S.card}>
              <div style={{ padding: "13px 14px 11px", display: "flex", flexDirection: "column", gap: 10, borderBottom: `1px solid ${C.ligne2}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.label}>ÉTAPE 2 · LIVREUR</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: C.encre2 }}>{livreurCompteur}</span>
                </div>
                <div style={S.search}>
                  <span style={{ fontSize: 12, color: C.muted3 }}>⌕</span>
                  <input
                    value={rechercheLivreur}
                    onChange={(e) => onRechercheLivreur && onRechercheLivreur(e.target.value)}
                    placeholder="Nom, téléphone…"
                    style={S.input}
                  />
                </div>
              </div>
              <div className="bd-livreurs">
                {livreurs.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onLivreurPick && onLivreurPick(l.id)}
                    style={{
                      textAlign: "left",
                      fontFamily: "inherit",
                      color: "inherit",
                      padding: "9px 10px",
                      borderRadius: 14,
                      cursor: "pointer",
                      border: `1.5px solid ${l.selected ? C.jaune : C.ligne3}`,
                      background: l.selected ? "linear-gradient(160deg, rgba(255,238,50,.30), rgba(255,209,0,.12))" : C.surface,
                      boxShadow: l.selected ? "0 8px 20px rgba(255,209,0,.24)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ ...S.avatar, width: 32, height: 32, fontSize: 12 }}>{l.initiales}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.nom}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.ligneSecondaire}</div>
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "right", flex: "none" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, ...S.num }}>{l.compteur}</div>
                        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: C.muted3 }}>ÉLIGIBLES</div>
                      </div>
                    </div>
                  </button>
                ))}
                {livreurs.length === 0 && (
                  <div style={{ padding: "30px 14px", textAlign: "center", fontSize: 11.5, color: C.muted2 }}>Aucun livreur à afficher.</div>
                )}
              </div>
            </section>

            {/* état vide côté droit si aucun livreur sélectionné */}
            {!livreurNom ? (
              <div style={{ background: "rgba(255,255,255,.72)", border: "1.5px dashed #DAD8CC", borderRadius: 20, padding: "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
                <div style={{ width: 48, height: 48, borderRadius: 16, background: "rgba(255,209,0,.14)", display: "grid", placeItems: "center", fontSize: 19 }}>🧭</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.encre2 }}>Choisissez un livreur de {zone?.nom}</div>
                <div style={{ fontSize: 11.5, color: C.muted2, maxWidth: 380, textWrap: "pretty" }}>
                  La liste des colis proposés s'affichera ici.
                </div>
              </div>
            ) : (
              <div className="bd-workspace">
                {/* ÉTAPE 3 — COLIS : recherche, puces de filtre, pagination */}
                <section style={S.card}>
                  <div style={{ padding: "13px 15px 11px", display: "flex", flexDirection: "column", gap: 10, borderBottom: `1px solid ${C.ligne2}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={S.label}>ÉTAPE 3 · COLIS ÉLIGIBLES</span>
                      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: C.encre2 }}>{colisCompteur}</span>
                    </div>
                    <div style={S.search}>
                      <span style={{ fontSize: 12, color: C.muted3 }}>⌕</span>
                      <input
                        value={rechercheColis}
                        onChange={(e) => onRechercheColis && onRechercheColis(e.target.value)}
                        placeholder="Code, client, quartier…"
                        style={S.input}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "auto", paddingBottom: 2 }}>
                      {filtres.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => onFiltrePick && onFiltrePick(f.id)}
                          style={{
                            flex: "none",
                            fontFamily: "inherit",
                            border: `1px solid ${f.actif ? C.jaune : C.ligne}`,
                            background: f.actif ? "rgba(255,209,0,.22)" : C.surface,
                            color: f.actif ? "#8a7405" : C.muted,
                            fontSize: 10.5,
                            fontWeight: 800,
                            borderRadius: 20,
                            padding: "6px 11px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ maxHeight: 336, overflow: "auto" }}>
                    {colis.map((c) => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", String(c.id)); setSource("pool"); }}
                        onDragEnd={finDrag}
                        onDoubleClick={() => onColisAdd && onColisAdd(c.id)}
                        className="bd-ligne-colis"
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,209,0,.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span className="bd-grip" style={{ color: "#C9C7BA", fontSize: 12, letterSpacing: -1 }}>⠿</span>
                        <div className="bd-colis-identite" style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, ...S.num }}>{c.code}</div>
                          <div style={{ fontSize: 10.5, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.client}</div>
                        </div>
                        <div className="bd-colis-lieu" style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.encre2 }}>{c.ville}</div>
                          <div style={{ fontSize: 10.5, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.quartier}</div>
                        </div>
                        <div className="bd-colis-crbt" style={{ fontSize: 12, fontWeight: 800, textAlign: "right", ...S.num }}>{c.crbt}</div>
                        <button
                          type="button"
                          className="bd-colis-ajout"
                          onClick={() => onColisAdd && onColisAdd(c.id)}
                          style={{ width: 28, height: 28, borderRadius: 9, border: "1px solid rgba(255,209,0,.5)", background: "rgba(255,209,0,.18)", color: "#8a7405", fontSize: 14, fontWeight: 800, cursor: "pointer", lineHeight: 1, fontFamily: "inherit" }}
                        >
                          +
                        </button>
                      </div>
                    ))}

                    {resteAAfficher > 0 && (
                      <button
                        type="button"
                        onClick={onAfficherPlus}
                        style={{ width: "100%", border: "none", borderTop: `1px solid ${C.ligne2}`, background: "rgba(255,209,0,.10)", color: "#8a7405", fontSize: 11.5, fontWeight: 800, padding: 11, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        Afficher {resteAAfficher} colis de plus
                      </button>
                    )}
                    {colis.length === 0 && (
                      <div style={{ padding: "34px 18px", textAlign: "center", fontSize: 11.5, color: C.muted2 }}>Aucun colis à afficher.</div>
                    )}
                  </div>

                  <div style={{ padding: "10px 15px", borderTop: `1px solid ${C.ligne2}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={onAjouterFiltre}
                      style={{ border: `1px solid ${C.ligne}`, background: C.surface, color: C.encre2, fontSize: 11.5, fontWeight: 800, borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Ajouter tout le filtre
                    </button>
                    <span style={{ fontSize: 10.5, color: C.muted3 }}>Double-clic ou glisser fonctionne aussi</span>
                  </div>
                </section>

                {/* PANNEAU BON : scan + liste réordonnable + totaux */}
                <section
                  onDragOver={(e) => { e.preventDefault(); if (!dropActif) setDropActif(true); }}
                  onDragLeave={() => { setDropActif(false); setIndexCible(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (source === "bon") { onReorder && onReorder(id, indexCible ?? bon.length); }
                    else { onDropColis && onDropColis(id, indexCible); }
                    finDrag();
                  }}
                  style={{
                    background: dropActif ? "linear-gradient(180deg, rgba(255,238,50,.28), rgba(255,255,255,.9))" : "rgba(255,255,255,.82)",
                    border: `1.5px ${dropActif ? "dashed " + C.jaune : "solid " + C.ligne}`,
                    borderRadius: 20,
                    overflow: "hidden",
                    boxShadow: dropActif ? "0 14px 34px rgba(255,209,0,.26)" : "0 2px 10px rgba(32,32,32,.05)",
                    transition: "background .18s ease, box-shadow .18s ease",
                  }}
                >
                  <div style={{ padding: "13px 15px 11px", borderBottom: `1px solid ${C.ligne2}`, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={S.label}>BON · {livreurNom}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, color: C.encre2 }}>{bon.length} colis</span>
                    </div>

                    {scanVisible && (
                      <div style={{ display: "flex", alignItems: "center", gap: 9, background: C.encre, borderRadius: 13, padding: "9px 11px", animation: "bdPulse 2.4s ease-in-out infinite" }}>
                        <span style={{ fontSize: 14 }}>▮▯▮</span>
                        <input
                          value={scanValue}
                          onChange={(e) => onScanChange && onScanChange(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") onScanSubmit && onScanSubmit(); }}
                          placeholder="CLIC ICI AVANT LE SCAN"
                          style={{ ...S.input, flex: 1, fontWeight: 800, letterSpacing: 0.5, color: C.jaune }}
                        />
                        <button
                          type="button"
                          onClick={onScanSubmit}
                          style={{ border: "none", background: C.grad, color: "#3f2f00", fontSize: 11, fontWeight: 800, borderRadius: 9, padding: "6px 11px", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Ajouter
                        </button>
                      </div>
                    )}

                    {message && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.encre2, background: "rgba(255,209,0,.16)", border: "1px solid rgba(255,209,0,.35)", borderRadius: 10, padding: "8px 11px", animation: "bdFade .2s ease both" }}>
                        {message}
                      </div>
                    )}
                  </div>

                  <div style={{ minHeight: 200, maxHeight: 330, overflow: "auto", padding: "9px 11px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {bon.length === 0 && (
                      <div style={{ margin: "auto", padding: "26px 16px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 46, height: 46, borderRadius: 15, border: "2px dashed rgba(255,209,0,.7)", background: "rgba(255,209,0,.10)", display: "grid", placeItems: "center", fontSize: 18 }}>⚟</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.encre2 }}>Glissez ou scannez ici</div>
                        <div style={{ fontSize: 11, color: C.muted2, maxWidth: 240, textWrap: "pretty" }}>L'ordre de la liste devient l'ordre de la tournée.</div>
                      </div>
                    )}

                    {bon.map((c, i) => (
                      <div key={c.id}>
                        {indexCible === i && source && (
                          <div style={{ height: 3, borderRadius: 3, background: C.jaune, margin: "3px 0" }} />
                        )}
                        <div
                          draggable
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(c.id)); setSource("bon"); }}
                          onDragOver={(e) => { e.preventDefault(); if (indexCible !== i) setIndexCible(i); }}
                          onDragEnd={finDrag}
                          style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) auto 28px", gap: 9, alignItems: "center", background: C.surface, border: `1px solid ${C.ligne}`, borderRadius: 13, padding: "8px 10px", cursor: "grab", animation: "bdSlide .2s ease both" }}
                        >
                          <span style={{ width: 24, height: 24, borderRadius: 8, background: C.encre, color: C.jaune, fontSize: 10.5, fontWeight: 800, display: "grid", placeItems: "center", ...S.num }}>{i + 1}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, ...S.num }}>{c.code}</div>
                            <div style={{ fontSize: 10.5, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.ligneSecondaire}</div>
                          </div>
                          <div style={{ fontSize: 11.5, fontWeight: 800, ...S.num }}>{c.crbt}</div>
                          <button
                            type="button"
                            onClick={() => onColisRemove && onColisRemove(c.id)}
                            style={{ width: 26, height: 26, borderRadius: 8, border: `1px solid ${C.ligne3}`, background: C.surface2, color: "#b04a37", fontSize: 13, fontWeight: 800, cursor: "pointer", lineHeight: 1, fontFamily: "inherit" }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* auto-fit plutôt que 3 colonnes fixes : « 1 234,00 DH » ne
                      tient pas dans un tiers de colonne étroite, les totaux se
                      replient d'eux-mêmes plutôt que de déborder. */}
                  <div style={{ padding: "11px 15px 13px", borderTop: `1px solid ${C.ligne2}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10 }}>
                    {totaux.map((t) => (
                      <div key={t.label}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: C.muted3 }}>{t.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3, ...S.num }}>{t.value}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {/* JOURNAL (affiché seulement si le parent fournit des entrées) */}
      {journal.length > 0 && (
        <section style={{ background: C.encre, borderRadius: 20, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.jaune }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, color: C.jaune }}>HISTORIQUE · JOURNAL DES STATUTS</span>
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: C.muted2 }}>{journal.length} entrées</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflow: "auto" }}>
            {journal.map((e) => (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "86px minmax(0,1fr)", gap: 12, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.muted3, ...S.num }}>{e.heure}</span>
                <span style={{ fontSize: 12, color: "#EDEBE2", overflowWrap: "anywhere" }}>{e.texte}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MODALE DE CONFIRMATION — contenu fourni par le parent */}
      {confirmation?.ouverte && (
        <div
          onClick={onAnnuler}
          style={{ position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center", padding: "26px 18px", background: "radial-gradient(900px 600px at 50% 40%, rgba(32,32,32,.16), rgba(32,32,32,.36))", backdropFilter: "blur(9px) saturate(115%)", animation: "bdFade .24s ease both" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 560, maxWidth: "100%", borderRadius: 24, background: "linear-gradient(160deg, rgba(255,255,255,.86) 0%, rgba(255,255,255,.68) 46%, rgba(255,253,235,.74) 100%)", backdropFilter: "blur(26px) saturate(160%)", border: "1px solid rgba(255,255,255,.9)", boxShadow: "0 40px 90px rgba(32,32,32,.28)", overflow: "hidden", animation: "bdIn .3s cubic-bezier(.2,.8,.25,1) both" }}
          >
            <div style={{ height: 3, background: "linear-gradient(90deg,#FFEE32,#FFD100 55%, rgba(255,209,0,0))" }} />
            <div style={{ padding: "20px 22px 6px", display: "flex", alignItems: "flex-start", gap: 13 }}>
              <div style={{ ...S.avatar, width: 42, height: 42, borderRadius: 14, fontSize: 17, boxShadow: "0 8px 18px rgba(255,209,0,.36)" }}>🖨</div>
              <div>
                <div style={S.kicker}>VALIDATION DU BON</div>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, marginTop: 4 }}>{confirmation.titre}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted2, marginTop: 3 }}>{confirmation.sousTitre}</div>
              </div>
            </div>
            <div style={{ padding: "12px 22px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
              {(confirmation.totaux || []).map((t) => (
                <div key={t.label} style={{ background: "rgba(255,255,255,.6)", border: "1px solid rgba(255,255,255,.9)", borderRadius: 14, padding: "11px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.9, color: C.muted3 }}>{t.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>{t.value}</div>
                </div>
              ))}
            </div>
            {confirmation.texte && (
              <div style={{ padding: "14px 22px 0", fontSize: 12.5, color: C.encre3, textWrap: "pretty" }}>{confirmation.texte}</div>
            )}
            <div style={{ padding: "18px 22px 20px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={onAnnuler} style={{ ...S.btnGhost, border: "1px solid rgba(32,32,32,.12)", background: "rgba(255,255,255,.7)" }}>Annuler</button>
              <button type="button" onClick={onConfirmer} style={{ border: "none", background: C.encre, color: C.jaune, fontSize: 12.5, fontWeight: 800, borderRadius: 12, padding: "11px 18px", cursor: "pointer", fontFamily: "inherit" }}>
                Confirmer &amp; imprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
