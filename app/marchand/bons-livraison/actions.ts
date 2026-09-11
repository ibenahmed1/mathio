'use server';

import { revalidatePath } from 'next/cache';
import { getPageSession, roleMatches } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { creerBonsDeLivraison, type BonDeLivraisonGenere } from '@/lib/bons-livraison';

// Server Action : regroupe des colis "nouveau_colis" du marchand connecté dans
// un nouveau bon de livraison, puis les fait passer en "attente_de_ramassage".
//
// La règle métier elle-même vit dans lib/bons-livraison.ts, partagée avec
// POST /api/bons-livraison (flux admin) : ici on ne fait que résoudre QUI agit
// et sur QUEL périmètre.
//
// Note d'architecture : le reste du projet mute exclusivement via des routes
// `app/api/**` (protégées par le proxy qui lit le cookie de session et injecte
// des en-têtes `x-pd-user-*`, consommés par `requireUser()`). Les Server
// Actions ne passent pas par ce proxy (matcher `/api/:path*`), donc ici on
// vérifie la session directement via le cookie avec `getPageSession()` plutôt
// que `getSessionUser()`.
export async function creerBonDeLivraison(colisIds: string[]): Promise<BonDeLivraisonGenere> {
  const session = await getPageSession('marchand');
  if (!session || !roleMatches(session, ['marchand'])) {
    throw new Error('Authentification requise');
  }

  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) {
    throw new Error('Profil marchand introuvable');
  }

  // Périmètre borné à sa propre boutique : la sélection ne peut donc produire
  // qu'un seul bon, d'où le dépliage du tableau.
  const [bon] = await creerBonsDeLivraison({
    colisIds,
    utilisateurId: session.sub,
    marchandId: marchand.id,
  });

  revalidatePath('/marchand/bons-livraison');
  revalidatePath('/marchand/bons-livraison/nouveau');
  revalidatePath('/marchand/colis');

  return bon;
}
