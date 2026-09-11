'use client';

// L'espace applicatif n'est plus transmis par le client. Chaque espace ayant
// désormais son propre hôte, le proxy le déduit du `Host` de la requête — une
// valeur posée par le navigateur, que le JavaScript de page ne peut pas
// falsifier, contrairement à l'ancien header `x-pd-space`. Les appels
// ci-dessous restent des chemins relatifs : ils partent donc toujours vers
// l'hôte de l'espace courant, jamais vers un autre (voir spaceForHost dans
// lib/auth.ts).

// Porte le corps JSON complet de la réponse d'erreur (ex. le détail
// ligne-par-ligne `erreurs`/`doublons` de POST /api/commandes/import) — les
// appelants qui n'en ont pas besoin continuent à lire juste `.message`.
export class ApiRequestError extends Error {
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  // Le corps n'est pas toujours du JSON. Toutes les réponses de l'application
  // le sont (routes via jsonError, proxy), mais pas celles qui arrivent AVANT
  // elle : page HTML 502/504 de l'hébergeur, page « introuvable » de Next après
  // un déploiement raté ou sur un cache .next incohérent. `JSON.parse` levait
  // alors une SyntaxError (« Unexpected token '<' ») qui remontait telle
  // quelle — affichée mot pour mot par les écrans qui montrent `err.message`,
  // et en rejet non rattrapé ailleurs : les boutons de déconnexion restaient
  // sans effet, sans un mot. Un corps illisible cède donc la place au statut.
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Un 200 illisible n'est pas une donnée : le renvoyer tel quel ferait
      // lire `undefined` plus loin, à un endroit sans rapport avec la cause.
      throw new ApiRequestError(res.ok ? 'Réponse inattendue du serveur' : `Erreur ${res.status}`, null);
    }
  }

  if (!res.ok) {
    const erreur = (data as { error?: unknown } | null)?.error;
    const message = typeof erreur === 'string' ? erreur : `Erreur ${res.status}`;
    throw new ApiRequestError(message, data);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
