'use client';

import { useState } from 'react';
import s from './DocumentationApi.module.css';

// Bloc de code copiable, repris tel quel de la documentation déployée
// (§ public/MpLLAwOb3Nkr2xXW.html) : même cadre sombre, même pastille
// « Copier » en haut à droite qui passe à « Copié » une seconde et demie.
// Un intégrateur lit cette page une fois et en copie le contenu dix fois.
//
// Le repli de la page d'origine — sélectionner le bloc quand le presse-papiers
// est refusé (contexte non sécurisé, permission) — est conservé : mieux vaut
// une sélection à copier au clavier qu'un bouton qui ne fait rien.
export function BlocCode({ children }: { children: string }) {
  const [copie, setCopie] = useState(false);

  async function copier(evenement: React.MouseEvent<HTMLButtonElement>) {
    try {
      await navigator.clipboard.writeText(children);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 1500);
    } catch {
      const bloc = evenement.currentTarget.parentElement?.querySelector('pre');
      const selection = window.getSelection();
      if (!bloc || !selection) return;
      const plage = document.createRange();
      plage.selectNodeContents(bloc);
      selection.removeAllRanges();
      selection.addRange(plage);
    }
  }

  return (
    <div className={s.code}>
      <button type="button" onClick={copier} className={`${s.copy} ${copie ? s.copyOk : ''}`}>
        {copie ? 'Copié' : 'Copier'}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
