// Notifications instantanées du back-office (« toasts ») : un geste réussi ou
// raté s'annonce en coin d'écran, quelle que soit la place du message sur la
// page — un scan à la douchette se fait sans regarder l'écran, une remise se
// lance depuis un bandeau loin du résultat.
//
// Module PUR côté navigateur : aucune dépendance React. N'importe quel écran
// appelle `annoncerSucces` / `annoncerEchec` ; <Annonces /> (monté une fois dans
// AdminShell) écoute et affiche. Sans écouteur monté, l'appel ne fait rien.
//
// Ce n'est pas le centre de notifications (components/notifications) : rien
// n'est stocké, l'annonce disparaît d'elle-même après quelques secondes.

export type TypeAnnonce = 'succes' | 'echec' | 'info';

export interface Annonce {
  id: number;
  type: TypeAnnonce;
  texte: string;
  // Bip court : réservé aux scans, où l'opérateur regarde le colis, pas l'écran.
  son: boolean;
}

type Ecouteur = (annonce: Annonce) => void;

const ecouteurs = new Set<Ecouteur>();
let prochainId = 1;

export function ecouterAnnonces(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => {
    ecouteurs.delete(ecouteur);
  };
}

export function annoncer(type: TypeAnnonce, texte: string, options: { son?: boolean } = {}): void {
  const annonce: Annonce = { id: prochainId++, type, texte, son: options.son ?? false };
  for (const e of ecouteurs) e(annonce);
}

export function annoncerSucces(texte: string, options?: { son?: boolean }): void {
  annoncer('succes', texte, options);
}

// Accepte directement l'erreur attrapée : c'est le cas de tous les appels.
export function annoncerEchec(erreur: unknown, options?: { son?: boolean; prefixe?: string }): void {
  const message = erreur instanceof Error ? erreur.message : typeof erreur === 'string' ? erreur : 'Erreur';
  annoncer('echec', options?.prefixe ? `${options.prefixe} : ${message}` : message, options);
}
