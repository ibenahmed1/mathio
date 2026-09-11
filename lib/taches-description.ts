// Checklist d'une tâche (§ /admin/tasks).
//
// Le modèle `Tache` n'a pas de table d'étapes : la checklist vit DANS la
// description, en cases Markdown (« - [ ] étape », « - [x] étape »). La
// convention était jusqu'ici recopiée dans TaskFormModal (écriture) et
// TaskDetailModal (lecture/écriture), et la carte du board — qui ne la
// connaissait pas — affichait la description brute, tirets et crochets
// compris. Un seul endroit décide désormais de ce qu'est une étape.
//
// Module PUR : aucun import Prisma ni next/*, il est chargé aussi bien par les
// composants client du Kanban que par une route.

export type EtapeTache = { texte: string; fait: boolean };

/** Une case Markdown, tolérante à l'indentation et à la casse du « x ». */
const LIGNE_ETAPE = /^- \[([ xX])\]\s*(.*)$/;

/** Sépare le texte libre des cases à cocher. L'ordre des étapes est celui du
 *  texte : c'est l'ordre dans lequel elles ont été ajoutées. */
export function decouperDescription(description: string | null): { texte: string; etapes: EtapeTache[] } {
  const etapes: EtapeTache[] = [];
  const reste: string[] = [];
  for (const ligne of (description ?? '').split('\n')) {
    const m = LIGNE_ETAPE.exec(ligne.trim());
    if (m) etapes.push({ fait: m[1].toLowerCase() === 'x', texte: m[2] });
    else reste.push(ligne);
  }
  return { texte: reste.join('\n').trim(), etapes };
}

/** L'opération inverse. Toute écriture de la description passe par ici : les
 *  deux moitiés vivent dans le même champ, en enregistrer une seule effacerait
 *  l'autre. */
export function recomposerDescription(texte: string, etapes: EtapeTache[]): string {
  const bloc = etapes.map((e) => `- [${e.fait ? 'x' : ' '}] ${e.texte}`).join('\n');
  return [texte.trim(), bloc].filter(Boolean).join('\n\n');
}
