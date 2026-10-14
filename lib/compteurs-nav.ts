import { prisma } from '@/lib/prisma';
import { getColisEligiblesPrestataire } from '@/lib/bon-envoi-prestataire';
import { perimetreEnvoi } from '@/lib/circuit-shipeh';
import type { Prisma } from '@/app/generated/prisma/client';
import { roleMatches, sessionHasPermission, type SessionPayload } from '@/lib/auth';

// § Compteurs de la barre latérale (13/10/2026) — « ce qui attend un geste »,
// lien par lien : 3 nouveaux colis, 2 bons d'envoi à remettre… Chaque
// compteur n'est calculé que pour un compte qui voit le lien (même clé de
// permission que l'item de navigation, components/admin/nav.ts).

export type CleCompteur =
  | 'colis_nouveaux'
  | 'ramassages'
  | 'stock_nouveaux'
  | 'stock_prets'
  | 'bons_preparation'
  | 'prets_envoi'
  | 'bon_livraison'
  | 'bon_envoi'
  | 'reclamations'
  | 'reglements_retard';

const PERMISSION_COMPTEUR: Record<CleCompteur, string> = {
  colis_nouveaux: 'colis:read',
  ramassages: 'demande_ramassage:manage',
  stock_nouveaux: 'stock:nouveaux',
  stock_prets: 'stock:prets',
  bons_preparation: 'stock:bons_preparation',
  prets_envoi: 'bon_envoi:create',
  bon_livraison: 'bon_livraison:manage',
  bon_envoi: 'bon_envoi:manage',
  reclamations: 'reclamations:manage',
  reglements_retard: 'comptabilite:write',
};

export interface TransporteurPret {
  id: string;
  nom: string;
  nbColis: number;
}

// Colis prêts à partir, rangés par le transporteur qui dessert leur ville
// (§ chargerResolveurTransporteur) : mêmes règles d'éligibilité que la
// création d'un bon d'envoi, donc un colis compté ici peut y entrer. Un colis
// Shipeh n'est prêt qu'une fois scanné au hub central (§ circuit Shipeh).
export async function colisPretsParTransporteur(
  perimetre?: Prisma.CommandeWhereInput
): Promise<{ transporteurs: TransporteurPret[]; sansTransporteur: number }> {
  const [colis, prestataires] = await Promise.all([
    getColisEligiblesPrestataire({ perimetre }),
    prisma.prestataire.findMany({ where: { actif: true }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } }),
  ]);
  const parId = new Map(prestataires.map((p) => [p.id, { ...p, nbColis: 0 }]));
  let sansTransporteur = 0;
  for (const c of colis) {
    const prevu = c.transporteursVille[0];
    const ligne = prevu ? parId.get(prevu.id) : undefined;
    if (ligne) ligne.nbColis += 1;
    else sansTransporteur += 1;
  }
  return { transporteurs: [...parId.values()], sansTransporteur };
}

const COMPTEURS: Record<CleCompteur, (session: SessionPayload) => Promise<number>> = {
  // Liste principale : nouveaux colis hors préparation de stock (ceux-là ont
  // leurs propres listes).
  colis_nouveaux: () =>
    prisma.commande.count({ where: { statut: 'nouveau_colis', NOT: { enStock: true } } }),
  ramassages: () => prisma.ramassage.count({ where: { statut: 'en_attente' } }),
  stock_nouveaux: () => prisma.commande.count({ where: { enStock: true, statut: 'nouveau_colis' } }),
  stock_prets: () =>
    prisma.commande.count({ where: { enStock: true, statut: 'pret_pour_preparation', bonPreparationId: null } }),
  bons_preparation: () => prisma.bonDePreparation.count({ where: { statut: 'en_attente' } }),
  prets_envoi: async (session) => {
    const { transporteurs } = await colisPretsParTransporteur(perimetreEnvoi(session.role));
    return transporteurs.reduce((n, t) => n + t.nbColis, 0);
  },
  // Bon de livraison dont des colis attendent encore d'être reçus.
  bon_livraison: () => prisma.bonDeLivraison.count({ where: { commandes: { some: { statut: 'attente_de_ramassage' } } } }),
  bon_envoi: () => prisma.bonEnvoi.count({ where: { statut: 'nouveau' } }),
  reclamations: () => prisma.reclamation.count({ where: { statut: 'ouverte' } }),
  // Colis livrés par un transporteur, pas encore payés 24 h après
  // (§ lib/reglements-transporteurs.ts).
  reglements_retard: () =>
    prisma.creanceTransporteur.count({ where: { etat: 'a_recevoir', echeance: { lt: new Date() } } }),
};

export async function compterPour(session: SessionPayload): Promise<Partial<Record<CleCompteur, number>>> {
  const admin = roleMatches(session, ['admin']);
  const cles = (Object.keys(COMPTEURS) as CleCompteur[]).filter(
    (cle) => admin || sessionHasPermission(session, PERMISSION_COMPTEUR[cle])
  );
  // Un compteur en échec est omis, sans emporter les autres : la barre
  // latérale perdrait sinon toutes ses pastilles pour une seule requête.
  const valeurs = await Promise.allSettled(cles.map((cle) => COMPTEURS[cle](session)));
  const resultat: Partial<Record<CleCompteur, number>> = {};
  valeurs.forEach((v, i) => {
    if (v.status === 'fulfilled') resultat[cles[i]] = v.value;
    else console.error(`[compteurs-nav] ${cles[i]} :`, v.reason);
  });
  return resultat;
}
