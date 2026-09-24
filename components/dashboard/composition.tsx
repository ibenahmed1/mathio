import type { TonColis } from '@/lib/statuts';

// Vocabulaire visuel des tableaux de bord — palette, styles de base, pilule de
// statut et tracé de courbe.
//
// Ces valeurs viennent de la maquette « Améliorer l'interface du dashboard »
// (planche WSKZ .04) et vivaient dans components/admin/DashboardAccueil.tsx,
// seul écran à les porter. L'Accueil livreur reprenant la MÊME composition,
// elles sont sorties ici : deux copies auraient divergé au premier ajustement
// de teinte, et « le même style » serait redevenu une intention plutôt qu'un
// fait. Ni l'un ni l'autre des deux tableaux de bord ne définit plus de
// couleur en propre.

/* ===== Palette =====
   Bleu ciel, bleu, marine, plus l'ambre et l'orange — les mêmes que `--pal-*`
   dans app/globals.css. Elles sont redites ici plutôt que lues dans les
   variables CSS parce que d3 et les attributs SVG en ont besoin comme CHAÎNES
   au moment du rendu : `var(--pal-bleu)` posé en `fill` n'est pas résolu par d3.
   Le jaune (btnJaune, #FFE14D → #FFD000) sert À LA FOIS de couleur de commande
   et de couleur de donnée — il ferme le donut, porte la courbe des livraisons
   et le quatrième cadran. C'est le parti de la maquette : sur ces écrans il n'y
   a aucune zone cliquable jaune en dehors des boutons, et leur forme (fond
   plein, ombre portée) les distingue d'une série. */
export const P = {
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

// Le moment du cycle de vie d'un colis est une notion MÉTIER, décidée par
// lib/statuts.ts (§ tonColisDuStatut) : ce module ne fait que lui attacher un
// dégradé. Réexporté pour que les écrans n'aient qu'un import à faire.
export type { TonColis };

// Dégradé de la pilule de statut, repris de `GRAD` dans la maquette.
// Le bleu clair pour ce qui entre, l'ambre pour ce qui est en cours de
// traitement, le marine pour ce qui est abouti, l'orange pour ce qui sort du
// flux — un retour n'est pas un échec neutre, il coûte une tournée, et la
// teinte chaude est là pour qu'il se repère dans une colonne de statuts.
export const TON: Record<TonColis, string[]> = {
  amont: ['#8ECAE6', '#209EBB'],
  encours: ['#FFB701', '#FC8500'],
  livre: ['#209EBB', '#023047'],
  retour: ['#FC8500', '#E56A00'],
};

/* ===== Styles de base (composition) ===== */
export const cardTitle: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700 };
export const muted: React.CSSProperties = { fontSize: 11, color: '#8C8C86' };
export const kpiValue: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' };

/* ===== Formats ===== */
export const nombre = (n: number) => n.toLocaleString('fr-FR');
export const dirhams = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DH`;

export function StatusPill({ label, grad }: { label: string; grad: string[] }) {
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
export function courbe(valeurs: number[], largeur: number, hauteur: number, max: number): string {
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
export const PERIMETRE = 2 * Math.PI * 76;
