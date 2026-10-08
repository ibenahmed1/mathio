'use client';

import { Bell, BellOff, BookOpen, ClipboardList, LifeBuoy, Package, Smartphone, Truck, Wallet, Warehouse } from 'lucide-react';
import type { FamilleNotification } from '@/lib/notifications-catalogue';
import type { EtatPush } from '@/lib/push-client';

// § Notifications — ce que la cloche (panneau) et le centre de notifications
// (page) affichent de la même façon : une seule définition, pas deux qui
// divergent au premier ajustement.

export const ICONE_FAMILLE: Record<FamilleNotification, typeof Bell> = {
  colis: Package,
  argent: Wallet,
  support: LifeBuoy,
  terrain: Truck,
  exploitation: Warehouse,
  comptabilite: BookOpen,
  taches: ClipboardList,
};

export function depuis(iso: string): string {
  const secondes = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secondes < 60) return "à l'instant";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  if (heures < 48) return 'hier';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Même garde que le service worker : on ne suit qu'un chemin relatif.
export function lienSur(lien: string | null): string | null {
  return lien && lien.startsWith('/') && !lien.startsWith('//') ? lien : null;
}

// Le centre de notifications vit dans CHAQUE espace, sous son propre préfixe
// (/admin, /marchand, /livreur, /ramasseur) : on le déduit de la page où l'on
// se trouve, le seul repère commun aux quatre coquilles.
export function cheminCentre(pathname: string | null): string {
  const premier = pathname?.split('/')[1] ?? '';
  return ['admin', 'marchand', 'livreur', 'ramasseur'].includes(premier) ? `/${premier}/notifications` : '/';
}

export function BandeauPush({
  etat,
  enCours,
  onActiver,
}: {
  etat: EtatPush | null;
  enCours: boolean;
  onActiver: () => void;
}) {
  if (etat === 'a_activer') {
    return (
      <div className="flex items-center gap-3 border-b border-black/[0.06] bg-brand/[0.08] px-4 py-3 dark:border-white/10">
        <Smartphone className="h-4 w-4 shrink-0" />
        <p className="flex-1 text-xs">Recevez ces alertes sur cet appareil, même application fermée.</p>
        <button
          type="button"
          onClick={onActiver}
          disabled={enCours}
          className="shrink-0 rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {enCours ? 'Activation…' : 'Activer'}
        </button>
      </div>
    );
  }
  if (etat === 'refuse') {
    return (
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
        Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de
        l&apos;adresse) pour recevoir les alertes.
      </div>
    );
  }
  // Sur iPhone, le push web n'existe que pour un site ajouté à l'écran
  // d'accueil : ailleurs, `PushManager` est tout simplement absent.
  if (etat === 'indisponible' && typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent)) {
    return (
      <div className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
        Sur iPhone, ajoutez l&apos;application à l&apos;écran d&apos;accueil (Partager → « Sur l&apos;écran
        d&apos;accueil ») puis ouvrez-la de là pour recevoir les alertes.
      </div>
    );
  }
  return null;
}
