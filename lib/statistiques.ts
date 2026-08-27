import { prisma } from '@/lib/prisma';
import { STATUTS_TERMINAUX } from '@/lib/statuts';
import {
  ANCRAGE_PERIODE,
  assemblerVentilation,
  compteursDepuisStatuts,
  debutDeJour,
  joursEntre,
  type Compteurs,
  type LigneVentilation,
  type Periode,
  type PointEvolution,
  type RepartitionStatut,
} from '@/lib/statistiques-core';
import type { Prisma } from '@/app/generated/prisma/client';

// § Statistiques (/admin/statistique/**) — accès à la base.
//
// Le noyau de calcul (périodes, taux, agrégation en mémoire) vit dans
// lib/statistiques-core.ts, qui ne dépend de rien : c'est lui, et lui seul,
// qu'un composant client peut importer. Ce fichier-ci le réexporte pour que
// les Server Components n'aient qu'un seul import à écrire.
export * from '@/lib/statistiques-core';

export function filtrePeriode(periode: Periode): Prisma.CommandeWhereInput {
  if (!periode.debut) return {};
  return { [ANCRAGE_PERIODE]: { gte: periode.debut, lte: periode.fin } };
}

// ------------------------------------------------------------
// Agrégats (base de données)
// ------------------------------------------------------------

// Un seul groupBy pour les cinq compteurs plutôt que cinq count() : sur une
// table de colis qui grossit vite, c'est un seul balayage d'index au lieu de
// cinq.
export async function getCompteurs(where: Prisma.CommandeWhereInput): Promise<Compteurs> {
  const lignes = await prisma.commande.groupBy({
    by: ['statut'],
    where,
    _count: { _all: true },
  });
  return compteursDepuisStatuts(lignes.map((l) => ({ statut: l.statut, nb: l._count._all })));
}

// COD réellement encaissé : colis LIVRÉS uniquement. Même règle que la
// facturation (lib/facturation.ts) — sommer les retournés gonflerait le
// chiffre d'affaires d'un argent qui n'est jamais entré en caisse.
export async function getCodEncaisse(where: Prisma.CommandeWhereInput): Promise<number> {
  const somme = await prisma.commande.aggregate({
    where: { ...where, statut: 'livre' },
    _sum: { montantCod: true },
  });
  return Number(somme._sum.montantCod ?? 0);
}

export async function getRepartitionStatuts(
  where: Prisma.CommandeWhereInput
): Promise<RepartitionStatut[]> {
  const lignes = await prisma.commande.groupBy({
    by: ['statut'],
    where,
    _count: { _all: true },
    orderBy: { _count: { statut: 'desc' } },
  });
  return lignes.map((l) => ({ statut: l.statut, nb: l._count._all }));
}

// Agrégation en mémoire plutôt qu'en SQL : Prisma ne sait pas grouper par jour
// sans requête brute, et deux colonnes projetées sur une période bornée
// restent peu coûteuses. Même parti pris que le tableau de bord d'accueil.
// À revoir en $queryRaw + date_trunc le jour où « depuis le début » ramènera
// des centaines de milliers de lignes.
export async function getEvolution(periode: Periode): Promise<PointEvolution[]> {
  const debut = periode.debut ?? (await premiereDateColis());
  if (!debut) return [];

  const colis = await prisma.commande.findMany({
    where: filtrePeriode({ ...periode, debut }),
    select: { dateCreation: true, statut: true },
  });

  const nbJours = joursEntre(debut, periode.fin);
  // Au-delà de trois mois, un point par jour rend la courbe illisible et
  // pèse pour rien : on passe à la semaine.
  const pasHebdo = nbJours > 92;

  const seaux = new Map<string, PointEvolution>();
  for (let i = 0; i < nbJours; i++) {
    const d = new Date(debut);
    d.setDate(d.getDate() + i);
    const cle = cleSeau(d, pasHebdo);
    if (!seaux.has(cle)) {
      seaux.set(cle, { cle, label: labelSeau(d, pasHebdo), livres: 0, retournes: 0, autres: 0 });
    }
  }

  for (const c of colis) {
    const seau = seaux.get(cleSeau(c.dateCreation, pasHebdo));
    if (!seau) continue;
    if (c.statut === 'livre') seau.livres += 1;
    else if (c.statut === 'retourne') seau.retournes += 1;
    else seau.autres += 1;
  }

  return [...seaux.values()];
}

function lundiDeLaSemaine(d: Date): Date {
  const c = debutDeJour(d);
  // getDay() : 0 = dimanche. On ramène au lundi précédent.
  const decalage = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - decalage);
  return c;
}

function cleSeau(d: Date, hebdo: boolean): string {
  const ref = hebdo ? lundiDeLaSemaine(d) : debutDeJour(d);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;
}

function labelSeau(d: Date, hebdo: boolean): string {
  const ref = hebdo ? lundiDeLaSemaine(d) : d;
  const jour = String(ref.getDate()).padStart(2, '0');
  const mois = String(ref.getMonth() + 1).padStart(2, '0');
  return hebdo ? `sem. ${jour}/${mois}` : `${jour}/${mois}`;
}

async function premiereDateColis(): Promise<Date | null> {
  const premier = await prisma.commande.findFirst({
    orderBy: { dateCreation: 'asc' },
    select: { dateCreation: true },
  });
  return premier?.dateCreation ?? null;
}

// ------------------------------------------------------------
// Ventilations
// ------------------------------------------------------------

export async function getVentilationLivreur(
  where: Prisma.CommandeWhereInput
): Promise<LigneVentilation[]> {
  const lignes = await prisma.commande.groupBy({
    by: ['livreurId', 'statut'],
    where: { ...where, livreurId: { not: null } },
    _count: { _all: true },
    _sum: { montantCod: true },
  });

  const ids = [...new Set(lignes.map((l) => l.livreurId).filter((v): v is string => v !== null))];
  const livreurs = await prisma.utilisateur.findMany({
    where: { id: { in: ids } },
    select: { id: true, nomComplet: true, hub: { select: { nom: true } } },
  });
  const parId = new Map(livreurs.map((l) => [l.id, l]));

  return assemblerVentilation(
    lignes.map((l) => ({
      cle: l.livreurId as string,
      libelle: parId.get(l.livreurId as string)?.nomComplet ?? 'Livreur supprimé',
      sousTitre: parId.get(l.livreurId as string)?.hub?.nom ?? null,
      statut: l.statut,
      nb: l._count._all,
      cod: Number(l._sum.montantCod ?? 0),
    }))
  );
}

// La ville d'un colis est un texte libre dont la résolution vers le
// référentiel `Ville` est best-effort (cf. normaliserVille, lib/hub-stock.ts).
// On regroupe donc sur `villeId` quand il est résolu, et sur le texte
// normalisé sinon — plutôt que de jeter dans un seul seau « non référencée »
// tout ce qui n'a pas été rattaché, ce qui viderait la page de son intérêt sur
// un référentiel encore incomplet.
export async function getVentilationVille(
  where: Prisma.CommandeWhereInput
): Promise<LigneVentilation[]> {
  const lignes = await prisma.commande.groupBy({
    by: ['villeId', 'ville', 'statut'],
    where,
    _count: { _all: true },
    _sum: { montantCod: true },
  });

  const ids = [...new Set(lignes.map((l) => l.villeId).filter((v): v is string => v !== null))];
  const villes = await prisma.ville.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true } });
  const parId = new Map(villes.map((v) => [v.id, v.nom]));

  return assemblerVentilation(
    lignes.map((l) => {
      const nomRef = l.villeId ? parId.get(l.villeId) : undefined;
      const brut = (l.ville ?? '').trim();
      return {
        cle: l.villeId ?? `texte:${brut.toLowerCase()}`,
        libelle: nomRef ?? (brut || 'Ville non renseignée'),
        sousTitre: nomRef ? null : 'Hors référentiel',
        statut: l.statut,
        nb: l._count._all,
        cod: Number(l._sum.montantCod ?? 0),
      };
    })
  );
}

// « Zone » = hub de rattachement actuel du colis (le modèle n'a plus de
// secteurs depuis la migration 20260813131410_refonte_modele_hub_sans_secteurs).
export async function getVentilationHub(
  where: Prisma.CommandeWhereInput
): Promise<LigneVentilation[]> {
  const lignes = await prisma.commande.groupBy({
    by: ['hubActuelId', 'statut'],
    where,
    _count: { _all: true },
    _sum: { montantCod: true },
  });

  const ids = [...new Set(lignes.map((l) => l.hubActuelId).filter((v): v is string => v !== null))];
  const hubs = await prisma.hub.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true, ville: true } });
  const parId = new Map(hubs.map((h) => [h.id, h]));

  return assemblerVentilation(
    lignes.map((l) => ({
      cle: l.hubActuelId ?? 'sans-hub',
      libelle: l.hubActuelId ? (parId.get(l.hubActuelId)?.nom ?? 'Hub supprimé') : 'Jamais passé par un hub',
      sousTitre: l.hubActuelId ? (parId.get(l.hubActuelId)?.ville ?? null) : null,
      statut: l.statut,
      nb: l._count._all,
      cod: Number(l._sum.montantCod ?? 0),
    }))
  );
}

// Le destinataire n'a pas de table : son identité, c'est son téléphone. Deux
// colis au même numéro sont le même client, même si le nom est orthographié
// différemment — d'où le regroupement sur le téléphone et l'affichage du
// dernier nom connu.
export async function getVentilationClient(
  where: Prisma.CommandeWhereInput
): Promise<LigneVentilation[]> {
  const lignes = await prisma.commande.groupBy({
    by: ['clientTelephone', 'clientNom', 'statut'],
    where,
    _count: { _all: true },
    _sum: { montantCod: true },
  });

  return assemblerVentilation(
    lignes.map((l) => ({
      cle: l.clientTelephone,
      libelle: l.clientNom,
      sousTitre: l.clientTelephone,
      statut: l.statut,
      nb: l._count._all,
      cod: Number(l._sum.montantCod ?? 0),
    }))
  );
}

export { STATUTS_TERMINAUX };
