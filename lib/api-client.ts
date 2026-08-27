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
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (data && typeof data.error === 'string' ? data.error : null) ?? `Erreur ${res.status}`;
    throw new ApiRequestError(message, data);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
