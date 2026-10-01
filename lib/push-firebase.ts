import { SignJWT, importPKCS8 } from 'jose';

// § Notifications — envoi du push par Firebase Cloud Messaging (API HTTP v1).
//
// Pas de SDK `firebase-admin` : il tire une grosse arborescence de dépendances
// pour ne servir ici qu'à deux appels HTTP — obtenir un jeton OAuth à partir
// du compte de service, puis poster un message. `jose` (déjà là pour les
// sessions) signe l'assertion. Si l'on change un jour de fournisseur, c'est ce
// seul fichier qui bouge : lib/notifications.ts ne connaît que envoyerPush().
//
// Même contrat que lib/mailer.ts : sans configuration, rien ne part, rien
// n'échoue — un avertissement dans le journal, et la cloche fait son travail.

interface ConfigServeur {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function configServeur(): ConfigServeur | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // La clé privée du compte de service tient sur plusieurs lignes ; dans un
  // .env elle arrive le plus souvent avec des `\n` littéraux.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function pushConfigure(): boolean {
  return configServeur() !== null;
}

// Ce que le navigateur doit connaître pour obtenir son jeton : des valeurs
// PUBLIQUES par nature (Firebase les considère comme telles), servies à
// l'exécution par /api/notifications/push-config plutôt qu'inlinées en
// NEXT_PUBLIC_* — celles-ci sont figées au build, et une clé corrigée au
// démarrage n'y changerait rien.
export interface ConfigPushClient {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

export function configPushClient(): ConfigPushClient | null {
  const apiKey = process.env.FIREBASE_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.FIREBASE_APP_ID;
  const vapidKey = process.env.FIREBASE_VAPID_KEY;
  if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) return null;
  // Inutile d'inviter le navigateur à s'abonner si le serveur ne peut pas
  // pousser : l'abonnement serait silencieusement mort.
  if (!pushConfigure()) return null;
  return { apiKey, projectId, messagingSenderId, appId, vapidKey };
}

// --- Jeton OAuth du compte de service --------------------------------------
// Valable une heure ; gardé en mémoire et renouvelé cinq minutes avant la fin,
// pour ne pas payer un aller-retour Google à chaque notification.
let jetonAcces: { valeur: string; expireA: number } | null = null;

async function obtenirJetonAcces(config: ConfigServeur): Promise<string> {
  if (jetonAcces && jetonAcces.expireA - 5 * 60_000 > Date.now()) return jetonAcces.valeur;

  const cle = await importPKCS8(config.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(config.clientEmail)
    .setSubject(config.clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(cle);

  const reponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!reponse.ok) {
    throw new Error(`Jeton OAuth Firebase refusé (${reponse.status}) : ${(await reponse.text()).slice(0, 300)}`);
  }
  const corps = (await reponse.json()) as { access_token: string; expires_in: number };
  jetonAcces = { valeur: corps.access_token, expireA: Date.now() + corps.expires_in * 1000 };
  return corps.access_token;
}

export interface MessagePush {
  titre: string;
  corps: string | null;
  lien: string | null;
  type: string;
}

// `jeton_invalide` : FCM ne connaît plus cet appareil (désinstallé, permission
// retirée, jeton tourné). L'appelant supprime alors la ligne AppareilPush —
// c'est la SEULE purge des appareils morts, il ne faut pas la rater.
export type IssuePush = 'envoye' | 'jeton_invalide' | 'erreur';

export async function envoyerPush(jetons: string[], message: MessagePush): Promise<Map<string, IssuePush>> {
  const issues = new Map<string, IssuePush>();
  if (jetons.length === 0) return issues;

  const config = configServeur();
  if (!config) {
    console.warn('[push] Firebase non configuré (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) — push non envoyé.', {
      titre: message.titre,
      appareils: jetons.length,
    });
    for (const j of jetons) issues.set(j, 'erreur');
    return issues;
  }

  const acces = await obtenirJetonAcces(config);
  const url = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;

  // Message de DONNÉES seulement (pas de bloc `notification`) : c'est notre
  // service worker (public/sw-notifications.js) qui affiche, avec notre lien.
  // Un bloc `notification` ferait afficher le navigateur lui-même, et le
  // service worker en rajouterait une seconde. Toutes les valeurs de `data`
  // doivent être des chaînes.
  const donnees = {
    titre: message.titre,
    corps: message.corps ?? '',
    lien: message.lien ?? '',
    type: message.type,
  };

  // L'API v1 n'a pas d'envoi groupé : un appel par appareil, en parallèle.
  // Un compte a rarement plus de deux ou trois navigateurs.
  await Promise.all(
    jetons.map(async (jeton) => {
      try {
        const reponse = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${acces}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: jeton,
              data: donnees,
              // 24 h : au-delà, « votre colis a été refusé hier » n'est plus
              // une alerte, et la cloche l'a de toute façon gardé.
              webpush: { headers: { Urgency: 'high', TTL: '86400' } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (reponse.ok) {
          issues.set(jeton, 'envoye');
          return;
        }
        const texte = await reponse.text();
        issues.set(jeton, estJetonInvalide(reponse.status, texte) ? 'jeton_invalide' : 'erreur');
        if (!estJetonInvalide(reponse.status, texte)) {
          console.error(`[push] FCM a refusé l'envoi (${reponse.status}) : ${texte.slice(0, 300)}`);
        }
      } catch (erreur) {
        issues.set(jeton, 'erreur');
        console.error('[push] envoi FCM impossible :', erreur);
      }
    })
  );
  return issues;
}

// UNREGISTERED (404) : l'appareil s'est désabonné. SENDER_ID_MISMATCH (403) :
// jeton émis pour un autre projet Firebase — typiquement après un changement
// de projet. Dans les deux cas le jeton ne servira plus jamais. Un 400
// INVALID_ARGUMENT n'en fait PAS partie : il signale le plus souvent un défaut
// de NOTRE message, et purger les appareils pour une erreur de code serait
// perdre tous les abonnements d'un coup.
export function estJetonInvalide(status: number, corps: string): boolean {
  if (status === 404) return true;
  return /UNREGISTERED|SENDER_ID_MISMATCH/.test(corps);
}
