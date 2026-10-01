'use client';

import { apiGet, apiPost } from '@/lib/api-client';
import type { ConfigPushClient } from '@/lib/push-firebase';

// § Notifications — abonnement du NAVIGATEUR au push (NOTIFICATIONS.md).
//
// Le SDK Firebase n'est chargé qu'ici, et à la demande (import dynamique) :
// il pèse plusieurs dizaines de ko et ne sert qu'à obtenir un jeton, une fois
// par ouverture de l'application. Le recevoir est l'affaire du service worker
// (public/sw-notifications.js), qui ne le charge pas du tout.

const SW = '/sw-notifications.js';
// Le jeton de CE navigateur, pour pouvoir le retirer à la déconnexion.
const CLE_JETON = 'notifications.jeton';

export type EtatPush =
  | 'indisponible' // navigateur sans push, ou iPhone hors écran d'accueil
  | 'non_configure' // Firebase absent côté serveur, ou impersonation
  | 'refuse' // l'utilisateur a bloqué les notifications pour ce site
  | 'a_activer'
  | 'actif';

function navigateurCompatible(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function lireJetonLocal(): string | null {
  try {
    return window.localStorage.getItem(CLE_JETON);
  } catch {
    return null;
  }
}

function ecrireJetonLocal(jeton: string | null): void {
  try {
    if (jeton) window.localStorage.setItem(CLE_JETON, jeton);
    else window.localStorage.removeItem(CLE_JETON);
  } catch {
    // Stockage indisponible (navigation privée) : seul le retrait à la
    // déconnexion en pâtit, et le serveur purge le jeton au premier refus FCM.
  }
}

async function chargerConfig(): Promise<ConfigPushClient | null> {
  try {
    const { config } = await apiGet<{ config: ConfigPushClient | null }>('/api/notifications/push-config');
    return config;
  } catch {
    return null;
  }
}

export async function etatPush(): Promise<EtatPush> {
  if (!navigateurCompatible()) return 'indisponible';
  if (!(await chargerConfig())) return 'non_configure';
  if (Notification.permission === 'denied') return 'refuse';
  return Notification.permission === 'granted' && lireJetonLocal() ? 'actif' : 'a_activer';
}

async function obtenirEtEnregistrerJeton(config: ConfigPushClient): Promise<void> {
  const registration = await navigator.serviceWorker.register(SW);
  await navigator.serviceWorker.ready;

  const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    });
  const jeton = await getToken(getMessaging(app), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!jeton) throw new Error('Firebase n’a pas délivré de jeton');

  await apiPost('/api/notifications/appareils', { jeton, navigateur: navigator.userAgent });
  ecrireJetonLocal(jeton);
}

// Geste EXPLICITE de l'utilisateur (bouton) : c'est la seule façon d'obtenir
// la permission — les navigateurs refusent une demande faite sans clic, et
// Safari l'exige.
export async function activerPush(): Promise<EtatPush> {
  if (!navigateurCompatible()) return 'indisponible';
  const config = await chargerConfig();
  if (!config) return 'non_configure';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'refuse' : 'a_activer';

  await obtenirEtEnregistrerJeton(config);
  return 'actif';
}

// À l'ouverture de l'application, SANS rien demander : si la permission est
// déjà accordée, on renouvelle l'enregistrement. Firebase peut faire tourner
// le jeton, et c'est le seul moment où l'on apprendrait le nouveau.
export async function rafraichirPush(): Promise<void> {
  try {
    if (!navigateurCompatible() || Notification.permission !== 'granted' || !lireJetonLocal()) return;
    const config = await chargerConfig();
    if (config) await obtenirEtEnregistrerJeton(config);
  } catch (erreur) {
    console.warn('[push] renouvellement du jeton impossible', erreur);
  }
}

// Retire CE navigateur du compte connecté. Appelé AVANT la déconnexion : après,
// la session n'existe plus et le serveur refuserait de savoir à qui il est.
export async function desactiverPush(): Promise<void> {
  const jeton = lireJetonLocal();
  if (!jeton) return;
  try {
    await fetch('/api/notifications/appareils', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jeton }),
    });
  } catch {
    // Au pire, le jeton reste attaché à ce compte jusqu'à ce qu'un autre
    // compte se connecte sur ce navigateur (réattribution par upsert).
  }
  ecrireJetonLocal(null);
}
