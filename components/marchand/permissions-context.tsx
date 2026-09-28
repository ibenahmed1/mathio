'use client';

import { createContext, useContext, useMemo } from 'react';
import { TOUTES_PERMISSIONS_MARCHAND, permissionPageMarchand } from '@/lib/permissions-marchand';

// § Équipe & accès — les droits du compte connecté dans sa boutique, résolus
// UNE fois par rendu de l'espace (app/marchand/layout.tsx, côté serveur) et
// distribués aux écrans : la barre latérale masque les modules fermés, les
// pages masquent les boutons d'action.
//
// Comme le contexte d'activation, il ne protège RIEN : il évite d'afficher un
// bouton qui répondrait 403. Le refus réel est posé par le proxy
// (API_MARCHAND, lib/permissions-marchand.ts).
interface PermissionsMarchand {
  estTitulaire: boolean;
  permissions: string[];
}

const Contexte = createContext<PermissionsMarchand | null>(null);

export function PermissionsMarchandProvider({
  estTitulaire,
  permissions,
  children,
}: PermissionsMarchand & { children: React.ReactNode }) {
  const valeur = useMemo(() => ({ estTitulaire, permissions }), [estTitulaire, permissions]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

// Hors de l'espace marchand (aucun fournisseur), on répond « tout permis » :
// ces composants n'ont alors rien à masquer, et le serveur reste juge.
export function usePermissionsMarchand() {
  const ctx = useContext(Contexte);
  const permissions = ctx?.permissions ?? TOUTES_PERMISSIONS_MARCHAND;
  return {
    estTitulaire: ctx?.estTitulaire ?? true,
    permissions,
    peut: (cle: string) => permissions.includes(cle),
    // Ce lien mène-t-il à un écran ouvert ? Lu dans la MÊME table que celle
    // du proxy (PAGES_MARCHAND) : un onglet affiché est un onglet qui s'ouvre.
    peutOuvrir: (href: string) => {
      const requise = permissionPageMarchand(href.split('?')[0]);
      return !requise || permissions.includes(requise);
    },
  };
}
