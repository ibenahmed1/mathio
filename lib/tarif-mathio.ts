// § Tarif de livraison Mathio — prix de VENTE d'une livraison, à ne pas
// confondre avec le tarif du transporteur qui la réalise (prix d'achat,
// TarifPrestataireVille).
//
// DÉCISION DU 2026-10-09 : le plan « Par défaut » est un PRIX UNIQUE de
// 35 dh pour toutes nos villes, Casablanca comprise. Même valeur que
// TARIF_UNIQUE_PAR_DEFAUT dans scripts/plans-tarifaires/grille-par-defaut.ts
// (chantier des plans tarifaires) : quand ces plans seront codés, ils
// liront cette constante plutôt que d'en garder une copie.
//
// Module PUR, sans import : lisible par les routes comme par les écrans.
export const TARIF_LIVRAISON_MATHIO = 35;
