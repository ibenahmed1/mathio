'use client';

// Déduit l'espace applicatif (admin/marchand/terrain) depuis l'URL de la page
// courante et le transmet au proxy via `x-pd-space`. Cela lui permet de savoir
// quel cookie de session vérifier en priorité quand plusieurs sessions
// coexistent dans le même navigateur (ex. un onglet admin + un onglet
// marchand) ; ce n'est qu'un indice de routage, jamais une preuve d'autorité
// (voir resolveApiSession dans lib/auth.ts).
function currentSpaceHint(): string | null {
  if (typeof window === 'undefined') return null;
  const { pathname } = window.location;
  if (pathname.startsWith('/admin')) return 'admin';
  // La web app Planner est un espace de PAGES distinct, mais elle s'appuie sur
  // le cookie de l'espace 'admin' (le rôle `planner` y est rattaché, cf.
  // ROLE_SPACES dans lib/auth.ts) — c'est donc bien ce cookie-là que le proxy
  // doit essayer en premier depuis /planner/**.
  if (pathname.startsWith('/planner')) return 'admin';
  if (pathname.startsWith('/marchand')) return 'marchand';
  if (pathname.startsWith('/ramasseur')) return 'terrain';
  if (pathname.startsWith('/livreur')) return 'terrain';
  return null;
}

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
  const space = currentSpaceHint();
  if (space) headers['x-pd-space'] = space;

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
