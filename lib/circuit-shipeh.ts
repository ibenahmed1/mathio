import type { Prisma } from '@/app/generated/prisma/client';
import type { SourceCommande, StatutCommande } from '@/app/generated/prisma/enums';

// § Circuit Shipeh (décidé le 12/10/2026) — module PUR, lu par le serveur et
// par l'écran.
//
// Un colis Shipeh ne bouge que sur un geste physique constaté chez nous :
//   nouveau_colis ──(validation agent stock)──▶ pret_pour_preparation
//   ──(scan agent stock)──▶ recu_au_hub (hub central, Casablanca)
//   ──(ajout à un bon d'envoi : statut INCHANGÉ)──
//   ──(remise : API du transporteur, ou « Colis remis » après l'Excel)──▶ en_transit
//   ──(« Bon bien reçu »)──▶ recu_au_hub (hub de destination)
//
// Ses produits doivent être validés (statutReception = recu) et en stock dès
// son arrivée, sinon il est refusé (lib/plateforme-colis.ts).
//
// Les autres colis (nos marchands, Shopify, YouCan) gardent la logique
// d'avant : en transit dès l'entrée dans un bon d'envoi, « Expédié » à la
// remise par API.

export interface ColisCircuit {
  source: SourceCommande;
  enStock: boolean;
}

// Shopify et YouCan déposent aussi en `source = api`, mais jamais de colis
// « stock » : seul le stock commun d'une plateforme de vente (Shipeh) fait les
// deux.
export function suitCircuitShipeh(colis: ColisCircuit): boolean {
  return colis.source === 'api' && colis.enStock;
}

// Statut d'un colis qui entre dans un bon d'envoi. Un colis Shipeh reste où il
// est (reçu au hub central) : rien n'est encore parti.
export function statutEntreeBonEnvoi(colis: ColisCircuit & { statut: StatutCommande }): StatutCommande {
  return suitCircuitShipeh(colis) ? colis.statut : 'en_transit';
}

// Statut posé quand le transporteur a accepté le colis par son API.
export function statutApresRemise(colis: ColisCircuit): StatutCommande {
  return suitCircuitShipeh(colis) ? 'en_transit' : 'expedier_par_amana';
}

// Un colis Shipeh d'un bon encore ouvert qui n'a pas été remis : il est
// toujours au hub de départ. Le bon ne peut pas être marqué reçu tant qu'il en
// reste un.
export function attendRemise(colis: ColisCircuit & { statut: StatutCommande }): boolean {
  return suitCircuitShipeh(colis) && colis.statut === 'recu_au_hub';
}

// Un colis Shipeh n'entre dans un bon d'envoi qu'une fois scanné au hub
// central (« Reçu au hub ») : avant, il est encore dans l'entrepôt de stock.
export function refusShipehNonScanne(colis: ColisCircuit & { statut: StatutCommande; codeSuivi: string }): string | null {
  if (!suitCircuitShipeh(colis) || colis.statut === 'recu_au_hub') return null;
  return `${colis.codeSuivi} est un colis Shipeh « ${colis.statut} » : il doit d'abord être scanné par l'agent stock (Stock › Prêts pour préparation)`;
}

// Même règle, en filtre de requête (listes de colis ajoutables).
export const EXCLURE_SHIPEH_NON_SCANNES = {
  NOT: { source: 'api', enStock: true, statut: { not: 'recu_au_hub' } },
} satisfies Prisma.CommandeWhereInput;

export function noteEnTransit(hubNom: string | null): string {
  return hubNom ? `en transit vers ${hubNom}` : 'en transit';
}
