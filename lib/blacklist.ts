import { prisma } from '@/lib/prisma';

interface BlacklistCheckInput {
  telephone: string;
  nom: string;
  adresse?: string | null;
}

// RG-08 : vérification automatique de la liste noire à la création de toute
// commande (téléphone, nom client, ou adresse).
export async function checkBlacklist({ telephone, nom, adresse }: BlacklistCheckInput): Promise<boolean> {
  const match = await prisma.listeNoire.findFirst({
    where: {
      OR: [
        { type: 'telephone', valeur: telephone },
        { type: 'client', valeur: { equals: nom, mode: 'insensitive' } },
        ...(adresse ? [{ type: 'adresse' as const, valeur: { equals: adresse, mode: 'insensitive' as const } }] : []),
      ],
    },
    select: { id: true },
  });
  return match !== null;
}
