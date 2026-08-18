import { prisma } from '@/lib/prisma';

// § Gestion de stock (/admin/stock/bons-preparation) : à la validation d'un
// Bon de Préparation, chaque colis avance vers recu_au_hub (déjà disponible
// pour un livreur local) si sa ville de livraison est couverte par le Hub
// Central (Hub.isCentral, créé depuis /admin/hubs — c'est le seul entrepôt de
// préparation de la plateforme à ce jour), ou vers en_transit sinon (doit
// d'abord transiter vers le hub de destination). Comparaison insensible à la
// casse/aux espaces, `Commande.ville` étant un champ texte libre plutôt
// qu'une relation vers `Ville`.

export function normaliserVille(ville: string): string {
  return ville
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export async function getVillesHubCentral(): Promise<Set<string>> {
  const hub = await prisma.hub.findFirst({
    where: { isCentral: true },
    include: { villes: true },
  });
  const villes = hub?.villes.map((v) => normaliserVille(v.nom)) ?? [];
  return new Set(villes);
}

export function statutApresPreparation(ville: string, villesHubCentral: Set<string>): 'recu_au_hub' | 'en_transit' {
  return villesHubCentral.has(normaliserVille(ville)) ? 'recu_au_hub' : 'en_transit';
}
