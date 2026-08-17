import { prisma } from '@/lib/prisma';

// Résout le Marchand accessible à un utilisateur connecté avec le rôle
// "marchand" : soit le titulaire direct (Marchand.utilisateurId), soit un
// membre d'équipe invité par le titulaire (MarchandMembre). Centralise cette
// logique pour que chaque route marchand n'ait qu'à l'appeler une fois au
// lieu de refaire `prisma.marchand.findUnique({ where: { utilisateurId } })`
// et d'oublier le cas "membre".
export async function resolveMarchandForUser(utilisateurId: string) {
  const direct = await prisma.marchand.findUnique({ where: { utilisateurId } });
  if (direct) return direct;

  const membre = await prisma.marchandMembre.findUnique({
    where: { utilisateurId },
    include: { marchand: true },
  });
  return membre?.marchand ?? null;
}
