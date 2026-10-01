'use client';

import { apiPost } from '@/lib/api-client';
import { desactiverPush } from '@/lib/push-client';

// Déconnexion commune aux coquilles admin, marchand, livreur, ramasseur et à
// l'en-tête générique. Renvoie `null` si la session est bien fermée, sinon le
// message à montrer à l'utilisateur.
//
// Elle ne redirige PAS vers /login en cas d'échec, et ses appelants ne doivent
// pas le faire non plus : si POST /api/auth/logout n'a pas abouti, le cookie de
// session est toujours valide. Afficher l'écran de connexion ferait croire le
// poste libéré alors que la personne suivante retrouverait la session ouverte
// d'un retour arrière — exactement le cas qui compte sur un poste de hub ou un
// téléphone partagé. Un message qui dit « toujours connecté » vaut mieux.
//
// (MarchandShell n'en fait pas partie : son bouton quitte une impersonation et
// renvoie vers le back-office quoi qu'il arrive, sur un autre domaine.)
export async function deconnecter(): Promise<string | null> {
  // § Notifications : retirer ce navigateur du compte AVANT de fermer la
  // session (après, le serveur ne saurait plus à qui il appartient) — sur un
  // téléphone partagé, la personne suivante ne doit pas recevoir les alertes
  // de celle-ci. Ne lève pas : un échec ici n'empêche pas de se déconnecter.
  await desactiverPush();
  try {
    await apiPost('/api/auth/logout');
    return null;
  } catch (err) {
    const cause = err instanceof Error ? err.message : 'erreur inconnue';
    return `La déconnexion a échoué (${cause}). Votre session est toujours ouverte : réessayez dans un instant.`;
  }
}
