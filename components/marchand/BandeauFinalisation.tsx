'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { CHAMPS_A_FINALISER, RESUME_BLOCAGE } from '@/lib/marchand-activation';
import { useActivationMarchand } from './activation-context';
import { CHEMINS_VERROUILLES } from './nav';

// § Inscription progressive — le rappel permanent, posé en haut de l'espace
// marchand tant que le dossier n'est pas complet et validé.
//
// Il ne s'affiche PAS sur les écrans déjà verrouillés : ceux-là portent déjà
// le panneau de VerrouProfil, qui dit la même chose en plus détaillé. Deux
// messages identiques sur le même écran se neutralisent.
export function BandeauFinalisation() {
  const etat = useActivationMarchand();
  const pathname = usePathname();

  if (etat.operationnel) return null;
  if (CHEMINS_VERROUILLES.some((chemin) => pathname.startsWith(chemin))) return null;
  // Rien à faire depuis son espace : l'y renvoyer en boucle n'aiderait pas.
  if (etat.blocage === 'compte_suspendu') return null;

  const restants = etat.champsManquants.length;
  const total = CHAMPS_A_FINALISER.length;

  return (
    <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--mk-amber-line)] bg-[color:var(--mk-amber-soft)] px-4 py-3 text-[color:var(--mk-amber-ink)] sm:mx-6 print:hidden">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] font-medium">
        {RESUME_BLOCAGE[etat.blocage ?? 'profil_incomplet']}{' '}
        {restants > 0 && (
          <span className="font-normal opacity-80">
            Il reste {restants} champ{restants > 1 ? 's' : ''} sur {total} à renseigner — bons, ramassages et factures
            s&apos;ouvriront ensuite.
          </span>
        )}
      </p>
      {restants > 0 && (
        <Link
          href="/marchand/profil"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--mk-amber-ink)] px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
        >
          Compléter
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
