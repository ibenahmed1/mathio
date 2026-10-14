'use client';

import { useState } from 'react';
import { ColisTrackingModal as SuiviAdmin } from '@/components/admin/ColisTrackingModal';
import { ColisTrackingModal as SuiviMarchand } from '@/components/marchand/ColisTrackingModal';

// Code d'un colis cliquable, partout où il s'affiche : un clic ouvre la
// fenêtre de suivi — celle du back-office (historique complet), ou celle du
// marchand (les statuts seuls, § GET /api/commandes/[id]). Le clic ne remonte
// pas à la ligne : il ne coche ni ne décoche rien.
export function CodeColis({
  id,
  code,
  espace = 'admin',
  className = '',
}: {
  id: string;
  code: string;
  espace?: 'admin' | 'marchand';
  className?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const Suivi = espace === 'marchand' ? SuiviMarchand : SuiviAdmin;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOuvert(true);
        }}
        className={`font-mono hover:underline ${className}`}
        title="Voir le suivi du colis"
      >
        {code}
      </button>
      {ouvert && (
        <span onClick={(e) => e.stopPropagation()}>
          <Suivi commandeId={id} onClose={() => setOuvert(false)} />
        </span>
      )}
    </>
  );
}
