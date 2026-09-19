'use client';

import Link from 'next/link';
import { Lock, Hourglass, ShieldAlert, ArrowRight } from 'lucide-react';
import { LABELS_CHAMP_PROFIL, RESUME_BLOCAGE } from '@/lib/marchand-activation';
import { useActivationMarchand } from './activation-context';

// § Inscription progressive — l'écran verrouillé.
//
// Le contenu réel reste rendu, flouté et inerte derrière le panneau : le
// marchand voit qu'il y a bien quelque chose ici et ce qu'il gagne à finaliser
// son dossier — un écran vide ou une redirection ne le lui diraient pas. Ce
// contenu ne contient de toute façon rien : les API qu'il interroge répondent
// 403 tant que le verrou tient (exigerMarchandOperationnel).
//
// `inert` en plus du floutage : sans lui, les champs et boutons masqués
// restent atteignables au clavier et par un lecteur d'écran — un verrou
// purement visuel n'en est pas un, même quand le serveur refuse derrière.
export function VerrouProfil({ children }: { children: React.ReactNode }) {
  const etat = useActivationMarchand();

  if (etat.operationnel) return <>{children}</>;

  return (
    <div className="relative min-h-[60vh]">
      <div inert aria-hidden className="select-none opacity-50 blur-[3px]">
        {children}
      </div>
      <div className="absolute inset-0 flex items-start justify-center overflow-hidden p-4 pt-10 sm:pt-16">
        <PanneauBlocage />
      </div>
    </div>
  );
}

function PanneauBlocage() {
  const etat = useActivationMarchand();
  const Icone = etat.blocage === 'validation_en_attente' ? Hourglass : etat.blocage === 'compte_suspendu' ? ShieldAlert : Lock;

  const titre =
    etat.blocage === 'validation_en_attente'
      ? 'Dossier en cours de validation'
      : etat.blocage === 'compte_suspendu'
        ? 'Compte suspendu'
        : 'Finalisez votre inscription';

  return (
    <div className="w-full max-w-md rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-6 text-center shadow-[var(--mk-shadow-lift)]">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--mk-line-soft)] text-[color:var(--mk-ink-2)]">
        <Icone className="h-6 w-6" />
      </span>
      <h2 className="text-base font-black text-[color:var(--mk-ink)]">{titre}</h2>
      <p className="mt-2 text-sm text-[color:var(--mk-muted)]">{etat.blocage ? RESUME_BLOCAGE[etat.blocage] : ''}</p>

      {etat.champsManquants.length > 0 && (
        <>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {etat.champsManquants.map((champ) => (
              <li
                key={champ}
                className="rounded-full border border-[color:var(--mk-line)] bg-[color:var(--mk-line-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--mk-ink-2)]"
              >
                {LABELS_CHAMP_PROFIL[champ]}
              </li>
            ))}
          </ul>
          <Link
            href="/marchand/profil"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[color:var(--mk-ink)] px-4 py-2.5 text-sm font-bold text-[color:var(--mk-card)] transition-opacity hover:opacity-90"
          >
            Compléter mon profil
            <ArrowRight className="h-4 w-4" />
          </Link>
        </>
      )}
    </div>
  );
}
