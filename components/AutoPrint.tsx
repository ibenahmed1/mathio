'use client';

import { useEffect } from 'react';

// Déclenche automatiquement la boîte de dialogue d'impression du navigateur
// à l'ouverture de la page (ouverte depuis une modale de confirmation via
// target="_blank"). L'utilisateur garde la main : Échap ou Annuler ferme
// simplement la boîte de dialogue sans affecter la page.
export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
