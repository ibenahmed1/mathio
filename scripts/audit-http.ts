import http from 'node:http';
// lib/spaces : module pur, importable hors contexte Next.
import { SPACE_HOSTS, originForHost, type SessionSpace } from '../lib/spaces';

// Transport HTTP des scripts d'audit qui tapent les vraies routes.
//
// ------------------------------------------------------------
// Pourquoi node:http et pas fetch — deux raisons, pas une
// ------------------------------------------------------------
// 1. L'espace applicatif est déduit de l'en-tête `Host` (lib/spaces.ts) et le
//    contrôle CSRF compare `Origin` à l'origine de cet hôte (proxy.ts §2). Il
//    faut donc pouvoir forger les deux. Or `fetch` (undici) classe `Host` parmi
//    les en-têtes interdits et l'écrase SILENCIEUSEMENT par l'autorité de
//    l'URL : la requête part avec `Host: 127.0.0.1:3000`, le proxy ne reconnaît
//    pas cet hôte et renvoie un 404 à corps vide — impossible à distinguer
//    d'une route manquante.
//
// 2. Les espaces non-admin vivent sur des sous-domaines `.localhost`
//    (marchand.localhost, app.localhost). Windows ne les résout PAS : un
//    `fetch('http://app.localhost:3000')` échoue en ENOTFOUND avant même
//    d'atteindre le serveur. En forgeant le `Host` et en se connectant à
//    127.0.0.1, on n'a plus besoin d'aucune résolution DNS.
//
// Conséquence pratique : ces audits se lancent contre le serveur de
// développement TEL QU'IL TOURNE, sans reconfiguration, sans entrée dans le
// fichier hosts, et sans l'arrêter.

const CIBLE = new URL(process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000');

export interface Reponse {
  status: number;
  json: Record<string, unknown> | null;
  texte: string;
  // En-têtes `Set-Cookie` BRUTS, attributs compris : le bocal ci-dessous n'en
  // garde que la paire nom=valeur, alors qu'auditer l'isolation demande de
  // lire SameSite, HttpOnly, Path et Max-Age (cf.
  // test-isolation-domaines-audit.ts).
  setCookie: string[];
  location: string | null;
}

// Surcharges par requête, pour les scénarios qui doivent MENTIR au serveur :
// annoncer l'origine d'un autre espace, présenter un cookie qu'on n'a pas
// reçu, ou n'envoyer aucun des deux. Sans elles, un client d'audit est
// structurellement incapable de jouer l'attaquant.
export interface OptionsRequete {
  // Hôte annoncé, à la place de celui du client. Sert au seul cas qu'aucun
  // client ne peut jouer : un `Host` qui n'appartient à AUCUN espace.
  host?: string;
  // Origine annoncée. `null` = aucun en-tête Origin (cas d'un client non
  // navigateur, ou d'un formulaire cross-site en navigation de haut niveau).
  origin?: string | null;
  // Remplace intégralement l'en-tête Cookie ; `null` = aucun cookie envoyé.
  cookie?: string | null;
  // Ne pas mémoriser les Set-Cookie de cette réponse : utile quand on teste
  // une connexion qui ne doit PAS aboutir, pour ne pas polluer le bocal.
  ignorerCookies?: boolean;
}

export interface ClientAudit {
  hote: string;
  origine: string;
  api(methode: string, chemin: string, corps?: unknown, options?: OptionsRequete): Promise<Reponse>;
  // Valeur brute d'un cookie du bocal — sert à le REJOUER sur l'hôte d'un
  // autre espace, le test central de l'isolation par domaine.
  cookie(nom: string): string | undefined;
  sessionOuverte(): boolean;
  reinitialiser(): void;
}

// Un client par espace : chacun a son bocal à cookies et annonce son propre
// `Host`, ce qui reproduit fidèlement l'isolation par domaine. Un scénario qui
// fait dialoguer un planner et un livreur en crée donc deux.
export function creerClient(space: SessionSpace): ClientAudit {
  // L'hôte peut être surchargé (AUDIT_HOST) pour l'espace admin uniquement,
  // qui est le seul que la configuration du dépôt pointe parfois sur un
  // tunnel. Les autres suivent SPACE_HOSTS.
  const hote = (space === 'admin' ? process.env.AUDIT_HOST : undefined) ?? SPACE_HOSTS[space];
  const origine = originForHost(hote);
  const cookies = new Map<string, string>();

  function api(
    methode: string,
    chemin: string,
    corps?: unknown,
    options: OptionsRequete = {}
  ): Promise<Reponse> {
    const charge = corps === undefined ? null : Buffer.from(JSON.stringify(corps), 'utf8');

    // `undefined` = comportement par défaut (l'origine de l'hôte annoncé, le
    // bocal du client) ; `null` = en-tête volontairement absent.
    const originEnvoye = 'origin' in options ? options.origin : origine;
    const cookieEnvoye =
      'cookie' in options
        ? options.cookie
        : cookies.size > 0
          ? [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
          : null;

    return new Promise((resolve, reject) => {
      const requete = http.request(
        {
          host: CIBLE.hostname,
          port: CIBLE.port || 80,
          path: chemin,
          method: methode,
          headers: {
            Host: options.host ?? hote,
            ...(originEnvoye ? { Origin: originEnvoye } : {}),
            'Content-Type': 'application/json',
            ...(charge ? { 'Content-Length': charge.length } : {}),
            ...(cookieEnvoye ? { Cookie: cookieEnvoye } : {}),
          },
        },
        (reponse) => {
          const morceaux: Buffer[] = [];
          reponse.on('data', (m: Buffer) => morceaux.push(m));
          reponse.on('end', () => {
            const texte = Buffer.concat(morceaux).toString('utf8');
            let json: Record<string, unknown> | null = null;
            try {
              json = texte ? JSON.parse(texte) : null;
            } catch {
              /* réponse non JSON (page HTML, redirection) */
            }

            const setCookie = reponse.headers['set-cookie'] ?? [];
            if (!options.ignorerCookies) {
              for (const brut of setCookie) {
                const paire = brut.split(';')[0];
                const i = paire.indexOf('=');
                if (i > 0) cookies.set(paire.slice(0, i), paire.slice(i + 1));
              }
            }

            resolve({
              status: reponse.statusCode ?? 0,
              json,
              texte,
              setCookie,
              location: reponse.headers.location ?? null,
            });
          });
        }
      );

      requete.on('error', reject);
      if (charge) requete.write(charge);
      requete.end();
    });
  }

  return {
    hote,
    origine,
    api,
    cookie: (nom: string) => cookies.get(nom),
    sessionOuverte: () => cookies.size > 0,
    reinitialiser: () => cookies.clear(),
  };
}

// ------------------------------------------------------------
// Client admin par défaut
// ------------------------------------------------------------
// La plupart des audits ne parlent qu'à l'espace admin : ils importent
// directement `api` sans se soucier des espaces.

const clientAdmin = creerClient('admin');

export const HOTE = clientAdmin.hote;
export const ORIGINE = clientAdmin.origine;
export const api = clientAdmin.api;
export const sessionOuverte = clientAdmin.sessionOuverte;
export const reinitialiserSession = clientAdmin.reinitialiser;

export async function attendreServeur(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await clientAdmin.api('GET', '/login');
      if (r.status < 500) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Serveur injoignable sur ${CIBLE.origin} (Host: ${clientAdmin.hote}). ` +
      'Lancer `npm run dev`, ou surcharger AUDIT_BASE_URL / AUDIT_HOST.'
  );
}
