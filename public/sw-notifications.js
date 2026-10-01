// § Notifications — service worker du push (NOTIFICATIONS.md).
//
// Fichier AUTONOME, sans le SDK Firebase : le navigateur n'a besoin du SDK que
// pour obtenir son jeton (lib/push-client.ts), pas pour recevoir. Le serveur
// n'envoie que des messages de DONNÉES (lib/push-firebase.ts) : c'est ici, et
// seulement ici, qu'ils deviennent une notification affichée — un bloc
// `notification` côté FCM en ferait afficher une seconde par le navigateur.
//
// Servi depuis public/, à la racine de CHAQUE domaine (admin, marchand,
// terrain) : un service worker ne contrôle que son origine, et chaque espace
// enregistre donc le sien.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Seul un chemin RELATIF à notre origine est suivi. Le lien vient de notre
// serveur, mais un `//autre-domaine` ou un `https://…` glissé là par une
// erreur de code ne doit pas pouvoir emmener l'utilisateur ailleurs.
function lienSur(lien) {
  return typeof lien === 'string' && lien.startsWith('/') && !lien.startsWith('//') ? lien : '/';
}

self.addEventListener('push', (event) => {
  let donnees = {};
  try {
    const recu = event.data ? event.data.json() : {};
    // FCM enveloppe les données dans `data` ; on accepte aussi un envoi brut.
    donnees = recu.data || recu;
  } catch {
    donnees = {};
  }

  event.waitUntil(
    (async () => {
      // Toujours afficher : certains navigateurs (Safari, Chrome) retirent la
      // permission à un site qui reçoit des push sans rien montrer.
      await self.registration.showNotification(donnees.titre || 'Mathio Delivery', {
        body: donnees.corps || '',
        icon: '/mathio-logo.png',
        data: { lien: lienSur(donnees.lien) },
      });
      // Prévient les onglets ouverts : leur cloche se met à jour sans attendre
      // son rafraîchissement périodique.
      const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const f of fenetres) f.postMessage({ type: 'notification-recue' });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(lienSur(event.notification.data && event.notification.data.lien), self.location.origin).href;

  event.waitUntil(
    (async () => {
      // Réutiliser un onglet déjà ouvert sur l'application plutôt que d'en
      // empiler un nouveau à chaque notification.
      const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const f of fenetres) {
        if ('focus' in f) {
          await f.focus();
          if ('navigate' in f) await f.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
