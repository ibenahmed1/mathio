'use client';

import { createContext, useContext } from 'react';
import type { EtatActivationMarchand } from '@/lib/marchand-activation';

// § Inscription progressive — l'état d'activation, calculé UNE fois par rendu
// de l'espace marchand (app/marchand/layout.tsx, côté serveur) et distribué
// aux écrans qui doivent se verrouiller.
//
// Un contexte plutôt qu'un appel API par page : l'information est la même
// partout, et un écran qui la chargerait lui-même s'afficherait d'abord
// déverrouillé le temps de la requête — exactement ce qu'on veut éviter.
//
// Cet état ne protège RIEN : il explique. Le refus réel est posé côté serveur
// par exigerMarchandOperationnel() (lib/marchand-scope.ts), et c'est là qu'il
// faut regarder pour savoir ce qui est réellement fermé.
const ContexteActivation = createContext<EtatActivationMarchand | null>(null);

export function ActivationMarchandProvider({
  etat,
  children,
}: {
  etat: EtatActivationMarchand;
  children: React.ReactNode;
}) {
  return <ContexteActivation.Provider value={etat}>{children}</ContexteActivation.Provider>;
}

// Hors de l'espace marchand (aucun fournisseur au-dessus), on répond
// « opérationnel » : ces composants n'ont alors rien à verrouiller, et un
// faux verrou serait un écran vide inexplicable. Le serveur reste juge.
const ETAT_PAR_DEFAUT: EtatActivationMarchand = {
  profilComplet: true,
  champsManquants: [],
  blocage: null,
  operationnel: true,
};

export function useActivationMarchand(): EtatActivationMarchand {
  return useContext(ContexteActivation) ?? ETAT_PAR_DEFAUT;
}
