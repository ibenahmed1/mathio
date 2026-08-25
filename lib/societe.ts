import { prisma } from '@/lib/prisma';

// § Paramètres de la société (/admin/parametres) — identité imprimée sur tous
// les documents sortants. Voir le commentaire du modèle ParametresSociete.

// Ligne unique : l'identifiant est fixe, il n'y a jamais qu'une société.
export const ID_SOCIETE = 'societe';

export interface ParametresSociete {
  raisonSociale: string;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  siteWeb: string | null;
  logoUrl: string | null;
}

const DEFAUTS: ParametresSociete = {
  raisonSociale: 'Mathio Delivery',
  adresse: null,
  telephone: null,
  email: null,
  siteWeb: null,
  logoUrl: null,
};

// Lecture tolérante : la ligne est créée par la migration, mais une base
// restaurée ou un jeu de test partiel ne doit pas faire échouer l'impression
// d'une facture. On retombe sur les valeurs par défaut plutôt que de lever —
// un document sans adresse reste utilisable, un document qui ne s'affiche pas
// ne l'est pas.
export async function getParametresSociete(): Promise<ParametresSociete> {
  const ligne = await prisma.parametresSociete.findUnique({
    where: { id: ID_SOCIETE },
    select: {
      raisonSociale: true,
      adresse: true,
      telephone: true,
      email: true,
      siteWeb: true,
      logoUrl: true,
    },
  });
  return ligne ?? DEFAUTS;
}
