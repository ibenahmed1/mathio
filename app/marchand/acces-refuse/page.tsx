'use client';

import { ShieldOff } from 'lucide-react';
import { apiPost } from '@/lib/api-client';

// § Équipe & accès — destination du proxy quand le rôle d'un membre ne lui
// ouvre AUCUN module (premiereDestinationMarchand). Rare, mais possible avec
// un rôle personnalisé réduit à « Consulter l'équipe » décoché : mieux vaut un
// écran qui l'explique qu'une boucle de redirections.
export default function AccesRefusePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-black/[0.05] dark:bg-white/[0.08]">
        <ShieldOff className="h-7 w-7 opacity-60" />
      </span>
      <h1 className="text-xl font-black">Aucun module ne vous est ouvert</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Votre rôle dans l’équipe ne donne accès à aucun écran de la boutique. Demandez au responsable de l’équipe de
        vous attribuer un rôle adapté.
      </p>
      <button
        type="button"
        className="btn-outline"
        onClick={async () => {
          try {
            await apiPost('/api/auth/logout');
          } finally {
            window.location.href = '/login';
          }
        }}
      >
        Se déconnecter
      </button>
    </div>
  );
}
