'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { nextBonLivraisonNumero } from '@/lib/codes';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

export interface BonDeLivraisonGenere {
  id: string;
  numero: string;
  nbColis: number;
  montantTotalCod: string;
}

// Server Action : regroupe des colis "nouveau_colis" du marchand connecté dans
// un nouveau bon de livraison, puis les fait passer en "attente_de_ramassage"
// (RG-10 : historisation du changement de statut comme pour toute transition).
//
// Note d'architecture : le reste du projet mute exclusivement via des routes
// `app/api/**` (protégées par le proxy qui lit le cookie de session et injecte
// des en-têtes `x-pd-user-*`, consommés par `requireUser()`). Les Server
// Actions ne passent pas par ce proxy (matcher `/api/:path*`), donc ici on
// vérifie la session directement via le cookie avec `getPageSession()` plutôt
// que `getSessionUser()`.
export async function creerBonDeLivraison(colisIds: string[]): Promise<BonDeLivraisonGenere> {
  const session = await getPageSession('marchand');
  if (!session || session.role !== 'marchand') {
    throw new Error('Authentification requise');
  }

  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) {
    throw new Error('Profil marchand introuvable');
  }

  const ids = Array.from(new Set(colisIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) {
    throw new Error('Sélectionnez au moins un colis');
  }

  const colis = await prisma.commande.findMany({
    where: { id: { in: ids }, marchandId: marchand.id, statut: 'nouveau_colis', bonLivraisonId: null },
  });

  if (colis.length !== ids.length) {
    throw new Error('Un ou plusieurs colis sélectionnés ne sont plus disponibles (déjà confirmés ou hors de votre compte)');
  }

  const montantTotalCod = colis.reduce((total, c) => total + Number(c.montantCod), 0);
  const numero = await nextBonLivraisonNumero();

  const bon = await prisma.$transaction(async (tx) => {
    const created = await tx.bonDeLivraison.create({
      data: {
        numero,
        marchandId: marchand.id,
        nbColis: colis.length,
        montantTotalCod,
      },
    });

    await tx.commande.updateMany({
      where: { id: { in: ids } },
      data: { bonLivraisonId: created.id, statut: 'attente_de_ramassage', dateConfirmation: new Date() },
    });

    await tx.historiqueStatutCommande.createMany({
      data: colis.map((c) => ({
        commandeId: c.id,
        ancienStatut: 'nouveau_colis' as const,
        nouveauStatut: 'attente_de_ramassage' as const,
        utilisateurId: session.sub,
      })),
    });

    return created;
  });

  revalidatePath('/marchand/bons-livraison');
  revalidatePath('/marchand/bons-livraison/nouveau');
  revalidatePath('/marchand/colis');

  return {
    id: bon.id,
    numero: bon.numero,
    nbColis: bon.nbColis,
    montantTotalCod: bon.montantTotalCod.toString(),
  };
}
