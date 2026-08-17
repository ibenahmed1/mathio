// Avatars "initiales" pour le Kanban (§ /admin/tasks) : les comptes équipe
// back-office n'ont pas systématiquement de photo, donc on retombe sur un
// rond coloré + initiales plutôt que de laisser un espace vide.
//
// Palette et forme (radius 33%, anneau inset) reprises à l'identique de
// reference-board-light.html / tokens.css (design_handoff_kanban) via les
// classes .kdc-av-0..5 (board.css) + variables --av-* (.kdc-board dans
// app/globals.css).

export function initiales(nomComplet: string): string {
  const mots = nomComplet.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
}

// nomComplet === null -> avatar neutre "ALL" (filtre "Assigné à : tout le
// monde"), cf. .kdc-avatar--all dans board.css.
export function avatarClassName(nomComplet: string | null): string {
  if (!nomComplet) return 'kdc-avatar--all';
  let hash = 0;
  for (let i = 0; i < nomComplet.length; i++) {
    hash = (hash * 31 + nomComplet.charCodeAt(i)) >>> 0;
  }
  return `kdc-av-${hash % 6}`;
}
