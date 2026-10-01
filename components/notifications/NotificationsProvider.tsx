'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import { activerPush, etatPush, rafraichirPush, type EtatPush } from '@/lib/push-client';

// § Notifications — l'état de la cloche, UN par coquille (admin, marchand,
// livreur, ramasseur). La barre latérale et la rangée mobile affichent chacune
// une cloche : elles lisent ce même état au lieu d'interroger le serveur
// chacune de leur côté.

export interface NotificationCloche {
  id: string;
  type: string;
  titre: string;
  corps: string | null;
  lien: string | null;
  lueLe: string | null;
  creeLe: string;
}

interface Page {
  notifications: NotificationCloche[];
  nonLues: number;
  suite: boolean;
}

interface EtatNotifications {
  notifications: NotificationCloche[];
  nonLues: number;
  suite: boolean;
  chargement: boolean;
  push: EtatPush | null;
  rafraichir: () => Promise<void>;
  chargerPlus: () => Promise<void>;
  marquerLues: (ids: string[] | 'tout') => Promise<void>;
  activer: () => Promise<void>;
}

const Contexte = createContext<EtatNotifications | null>(null);

// Toutes les minutes, et seulement onglet visible : le push, quand il est
// actif, prévient de toute façon plus tôt (message du service worker).
const PERIODE_MS = 60_000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationCloche[]>([]);
  const [nonLues, setNonLues] = useState(0);
  const [suite, setSuite] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [push, setPush] = useState<EtatPush | null>(null);
  // Dernière page chargée au-delà de la première : un rafraîchissement ne
  // doit pas faire disparaître ce que l'utilisateur est en train de parcourir.
  const plusAncienne = useRef<string | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      const page = await apiGet<Page>('/api/notifications');
      setNotifications((actuelles) => {
        const recentes = new Set(page.notifications.map((n) => n.id));
        const anciennes = plusAncienne.current ? actuelles.filter((n) => !recentes.has(n.id)) : [];
        return [...page.notifications, ...anciennes];
      });
      setNonLues(page.nonLues);
      if (!plusAncienne.current) setSuite(page.suite);
    } catch {
      // Silencieux : une cloche qui ne se met pas à jour ne doit pas couvrir
      // l'écran d'erreurs. La prochaine période réessaiera.
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerPlus = useCallback(async () => {
    const derniere = notifications[notifications.length - 1];
    if (!derniere) return;
    const page = await apiGet<Page>(`/api/notifications?avant=${encodeURIComponent(derniere.creeLe)}`);
    plusAncienne.current = page.notifications[page.notifications.length - 1]?.creeLe ?? derniere.creeLe;
    setNotifications((actuelles) => [...actuelles, ...page.notifications.filter((n) => !actuelles.some((a) => a.id === n.id))]);
    setSuite(page.suite);
  }, [notifications]);

  const marquerLues = useCallback(async (ids: string[] | 'tout') => {
    const maintenant = new Date().toISOString();
    // Optimiste : la pastille doit s'éteindre au clic, pas une seconde après.
    setNotifications((actuelles) =>
      actuelles.map((n) => (!n.lueLe && (ids === 'tout' || ids.includes(n.id)) ? { ...n, lueLe: maintenant } : n))
    );
    setNonLues((n) => (ids === 'tout' ? 0 : Math.max(0, n - ids.length)));
    try {
      await apiPost('/api/notifications/lues', ids === 'tout' ? { tout: true } : { ids });
    } catch {
      await rafraichir();
    }
  }, [rafraichir]);

  const activer = useCallback(async () => {
    try {
      setPush(await activerPush());
    } catch (erreur) {
      console.warn('[push] activation impossible', erreur);
      setPush(await etatPush());
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    void rafraichirPush().then(async () => setPush(await etatPush()));

    const minuterie = window.setInterval(() => {
      if (document.visibilityState === 'visible') void rafraichir();
    }, PERIODE_MS);
    const auRetour = () => {
      if (document.visibilityState === 'visible') void rafraichir();
    };
    const auMessage = (e: MessageEvent) => {
      if (e.data?.type === 'notification-recue') void rafraichir();
    };
    document.addEventListener('visibilitychange', auRetour);
    navigator.serviceWorker?.addEventListener('message', auMessage);
    return () => {
      window.clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
      navigator.serviceWorker?.removeEventListener('message', auMessage);
    };
  }, [rafraichir]);

  return (
    <Contexte.Provider
      value={{ notifications, nonLues, suite, chargement, push, rafraichir, chargerPlus, marquerLues, activer }}
    >
      {children}
    </Contexte.Provider>
  );
}

export function useNotifications(): EtatNotifications {
  const etat = useContext(Contexte);
  if (!etat) throw new Error('useNotifications doit être utilisé sous <NotificationsProvider>');
  return etat;
}
