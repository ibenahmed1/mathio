'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, CheckCheck, Settings, X } from 'lucide-react';
import { definitionNotification } from '@/lib/notifications-catalogue';
import { BandeauPush, ICONE_FAMILLE, cheminCentre, depuis, lienSur } from './affichage';
import { useNotifications, type NotificationCloche } from './NotificationsProvider';

// § Notifications — la cloche et son panneau.
//
// Deux présentations d'un même état (NotificationsProvider) :
//   - `barre`  : une ligne de la barre latérale, qui en reprend les classes
//                (passées par `classes`) pour ne pas détonner ;
//   - `bouton` : une icône seule, pour la rangée mobile et l'écran ramasseur,
//                où la barre latérale est hors écran ou absente.

function Pastille({ nombre, className = '' }: { nombre: number; className?: string }) {
  if (nombre <= 0) return null;
  return (
    <span
      className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[0.625rem] font-bold leading-[1.125rem] text-white ${className}`}
      aria-hidden
    >
      {nombre > 99 ? '99+' : nombre}
    </span>
  );
}

export function ClocheNotifications({
  variante,
  replie = false,
  classes,
}: {
  variante: 'barre' | 'bouton';
  // Barre latérale repliée (admin, livreur) : l'icône seule, la pastille dessus.
  replie?: boolean;
  classes?: { item?: string; icone?: string; libelle?: string; masque?: string };
}) {
  const { nonLues } = useNotifications();
  // Position du panneau ouvert, `null` quand il est fermé. Calculée AU CLIC,
  // contre l'ancre : à DROITE d'une cloche de barre latérale en desktop (la
  // barre est à gauche, le panneau déborde sur le contenu), SOUS la cloche
  // partout ailleurs, sur toute la largeur utile en mobile.
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const ancre = useRef<HTMLButtonElement>(null);
  const ouvert = position !== null;

  function basculer() {
    if (ouvert) {
      setPosition(null);
      return;
    }
    const r = ancre.current?.getBoundingClientRect();
    if (!r) return;
    const largeur = Math.min(400, window.innerWidth - 24);
    setPosition(
      window.innerWidth >= 1024 && r.left < 320
        ? { left: r.right + 12, bottom: Math.max(12, window.innerHeight - r.bottom), width: largeur }
        : { top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - largeur - 12)), width: largeur }
    );
  }
  const libelle = nonLues > 0 ? `Notifications (${nonLues} non lues)` : 'Notifications';

  return (
    <>
      {variante === 'barre' ? (
        <button
          ref={ancre}
          type="button"
          onClick={basculer}
          className={classes?.item}
          title={libelle}
          aria-label={libelle}
          aria-expanded={ouvert}
        >
          <span className={`${classes?.icone ?? ''} relative`}>
            <Bell className="h-4 w-4" />
            {replie && <Pastille nombre={nonLues} className="absolute -right-2 -top-2" />}
          </span>
          <span className={`${classes?.libelle ?? ''} ${replie ? classes?.masque ?? '' : ''} flex flex-1 items-center justify-between gap-2`}>
            Notifications
            <Pastille nombre={nonLues} />
          </span>
        </button>
      ) : (
        <button
          ref={ancre}
          type="button"
          onClick={basculer}
          className="relative inline-flex shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white p-2 text-black/70 shadow-sm transition hover:border-brand hover:bg-brand/10 hover:text-black dark:border-white/15 dark:bg-white/5 dark:text-white/80 pointer-coarse:p-3"
          aria-label={libelle}
          aria-expanded={ouvert}
        >
          <Bell className="h-5 w-5" />
          <Pastille nombre={nonLues} className="absolute -right-1.5 -top-1.5" />
        </button>
      )}
      {position && <Panneau ancre={ancre} position={position} onFermer={() => setPosition(null)} />}
    </>
  );
}

function Panneau({
  ancre,
  position,
  onFermer,
}: {
  ancre: React.RefObject<HTMLButtonElement | null>;
  position: React.CSSProperties;
  onFermer: () => void;
}) {
  const router = useRouter();
  const centre = cheminCentre(usePathname());
  const { notifications, nonLues, suite, chargement, push, chargerPlus, marquerLues, activer } = useNotifications();
  const panneau = useRef<HTMLDivElement>(null);
  const [activation, setActivation] = useState(false);

  useEffect(() => {
    function dehors(e: MouseEvent) {
      const cible = e.target as Node;
      if (panneau.current?.contains(cible) || ancre.current?.contains(cible)) return;
      onFermer();
    }
    function echap(e: KeyboardEvent) {
      if (e.key === 'Escape') onFermer();
    }
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ancre, onFermer]);

  function ouvrir(n: NotificationCloche) {
    if (!n.lueLe) void marquerLues([n.id]);
    const lien = lienSur(n.lien);
    if (lien) {
      onFermer();
      router.push(lien);
    }
  }

  async function activerIci() {
    setActivation(true);
    try {
      await activer();
    } finally {
      setActivation(false);
    }
  }

  return createPortal(
    <div
      ref={panneau}
      role="dialog"
      aria-label="Notifications"
      style={{ position: 'fixed', zIndex: 60, ...position }}
      className="flex max-h-[min(34rem,calc(100dvh-24px))] flex-col overflow-hidden rounded-xl border border-black/10 bg-white text-black shadow-2xl dark:border-white/10 dark:bg-neutral-950 dark:text-white"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
        <p className="text-sm font-bold">Notifications</p>
        <div className="flex items-center gap-1">
          {nonLues > 0 && (
            <button
              type="button"
              onClick={() => void marquerLues('tout')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-black/60 hover:bg-black/5 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tout marquer comme lu
            </button>
          )}
          <Link
            href={`${centre}?onglet=preferences`}
            onClick={onFermer}
            className="rounded-md p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
            aria-label="Choisir mes notifications"
            title="Choisir mes notifications"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={onFermer}
            className="rounded-md p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <BandeauPush etat={push} enCours={activation} onActiver={activerIci} />

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {chargement && notifications.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-black/50 dark:text-white/50">Chargement…</li>
        )}
        {!chargement && notifications.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-black/50 dark:text-white/50">
            <Bell className="h-6 w-6 opacity-40" />
            Aucune notification pour l&apos;instant.
          </li>
        )}
        {notifications.map((n) => {
          const def = definitionNotification(n.type);
          const Icone = def ? ICONE_FAMILLE[def.famille] : Bell;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => ouvrir(n)}
                className={`flex w-full items-start gap-3 border-b border-black/[0.04] px-4 py-3 text-left transition hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/5 ${
                  n.lueLe ? '' : 'bg-brand/[0.06]'
                }`}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/80">
                  <Icone className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.lueLe ? 'font-medium' : 'font-bold'}`}>{n.titre}</span>
                  {n.corps && <span className="mt-0.5 block truncate text-xs text-black/60 dark:text-white/60">{n.corps}</span>}
                  <span className="mt-1 block text-[0.6875rem] text-black/40 dark:text-white/40">{depuis(n.creeLe)}</span>
                </span>
                {!n.lueLe && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="Non lue" />}
              </button>
            </li>
          );
        })}
        {suite && (
          <li className="p-2">
            <button
              type="button"
              onClick={() => void chargerPlus()}
              className="w-full rounded-md py-2 text-xs font-semibold text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
            >
              Afficher plus
            </button>
          </li>
        )}
      </ul>

      <Link
        href={centre}
        onClick={onFermer}
        className="border-t border-black/[0.06] px-4 py-2.5 text-center text-xs font-semibold text-black/70 hover:bg-black/[0.03] dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5"
      >
        Centre de notifications : tout voir et choisir ce que je reçois
      </Link>
    </div>,
    document.body
  );
}
