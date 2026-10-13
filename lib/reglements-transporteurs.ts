import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { ApiError } from '@/lib/api-utils';
import { tarifsAchatParVille } from '@/lib/bon-envoi-prestataire';
import { cleRoutage } from '@/lib/hub-envoi';
import { idCategorieSysteme } from '@/lib/journal-comptable';
import { LONGUEUR_MAX_TITRE } from '@/lib/finance';

// § Règlements transporteurs (décidé le 13/10/2026, SOUS_TRAITANCE.md).
//
// Le transporteur encaisse le COD, garde ses frais (tarif de sa grille pour la
// ville du colis) et nous reverse le reste sous 24 h. Pour chaque colis livré
// qu'on lui a confié, une CRÉANCE dit ce qu'on attend de lui ; un VERSEMENT
// (argent reçu, saisi par nous) solde une ou plusieurs créances et passe au
// journal comptable comme recette — le journal reste le seul endroit où
// l'argent réel est inscrit.
//
// Les créances ne sont pas écrites par chaque route qui pose « livré » (API
// des transporteurs, webhooks, saisie admin, espace société) : elles sont
// SYNCHRONISÉES depuis l'état des colis (synchroniserCreances), appelée après
// ces écritures ET à chaque lecture de l'écran. Une route oubliée ne peut donc
// pas laisser un colis livré sans créance — au pire, elle apparaît à la
// lecture suivante.

export const DELAI_REVERSEMENT_MS = 24 * 60 * 60 * 1000;

const arrondi = (n: number) => Math.round(n * 100) / 100;

// Le transporteur à qui le colis a été confié : celui du bon d'envoi, visé
// directement ou à travers le hub régional qu'il tient.
const SELECT_COLIS_CONFIE = {
  id: true,
  ville: true,
  montantCod: true,
  dateLivraison: true,
  bonEnvoi: { select: { prestataireId: true, hubDestination: { select: { prestataireId: true } } } },
} satisfies Prisma.CommandeSelect;

function prestataireDe(c: Prisma.CommandeGetPayload<{ select: typeof SELECT_COLIS_CONFIE }>): string | null {
  return c.bonEnvoi?.prestataireId ?? c.bonEnvoi?.hubDestination?.prestataireId ?? null;
}

const CONFIE: Prisma.CommandeWhereInput = {
  bonEnvoi: { OR: [{ prestataireId: { not: null } }, { hubDestination: { prestataireId: { not: null } } }] },
};

/**
 * Aligne les créances sur l'état des colis. Idempotente.
 *   - colis confié et « livré » sans créance (ou créance annulée) → créance à recevoir ;
 *   - créance à recevoir dont le colis n'est plus « livré » → annulée.
 * Une créance PAYÉE n'est jamais touchée : l'argent est arrivé.
 */
export async function synchroniserCreances(commandeIds?: string[]): Promise<void> {
  const filtre: Prisma.CommandeWhereInput = commandeIds ? { id: { in: commandeIds } } : {};

  const aCreer = await prisma.commande.findMany({
    where: {
      ...filtre,
      ...CONFIE,
      statut: 'livre',
      OR: [{ creanceTransporteur: null }, { creanceTransporteur: { etat: 'annulee' } }],
    },
    select: SELECT_COLIS_CONFIE,
  });

  const grilles = new Map<string, Map<string, number>>();
  for (const c of aCreer) {
    const prestataireId = prestataireDe(c);
    if (!prestataireId) continue;
    if (!grilles.has(prestataireId)) grilles.set(prestataireId, await tarifsAchatParVille(prestataireId));
    const frais = grilles.get(prestataireId)!.get(cleRoutage(c.ville)) ?? null;
    const cod = Number(c.montantCod);
    const dateLivraison = c.dateLivraison ?? new Date();
    const donnees = {
      prestataireId,
      montantCod: cod,
      fraisTransporteur: frais,
      // Frais inconnus (ville sans tarif) : on attend le COD entier, et l'écran
      // alerte — toutes les villes doivent avoir un tarif.
      montantAttendu: arrondi(cod - (frais ?? 0)),
      dateLivraison,
      echeance: new Date(dateLivraison.getTime() + DELAI_REVERSEMENT_MS),
      etat: 'a_recevoir' as const,
      versementId: null,
    };
    await prisma.creanceTransporteur.upsert({
      where: { commandeId: c.id },
      create: { commandeId: c.id, ...donnees },
      update: donnees,
    });
  }

  await prisma.creanceTransporteur.updateMany({
    where: {
      etat: 'a_recevoir',
      commande: { ...filtre, statut: { not: 'livre' } },
    },
    data: { etat: 'annulee' },
  });
}

// Appel « fire and forget » après une écriture de statut : une créance ratée
// ici sera rattrapée à la prochaine lecture de l'écran.
export async function synchroniserCreancesSansErreur(commandeIds: string[]): Promise<void> {
  try {
    await synchroniserCreances(commandeIds);
  } catch (erreur) {
    console.error('[reglements-transporteurs] synchronisation des créances :', erreur);
  }
}

// --- Lecture ----------------------------------------------------------------

export interface SyntheseTransporteur {
  id: string;
  nom: string;
  attendu: number;
  nbARecevoir: number;
  nbEnRetard: number;
  montantEnRetard: number;
  recuCeMois: number;
  ecarts: number;
  nbFraisInconnus: number;
}

function debutDuMois(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function syntheseParTransporteur(): Promise<SyntheseTransporteur[]> {
  await synchroniserCreances();
  const maintenant = new Date();
  const [prestataires, creances, versements] = await Promise.all([
    prisma.prestataire.findMany({ where: { actif: true }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } }),
    prisma.creanceTransporteur.findMany({
      where: { etat: 'a_recevoir' },
      select: { prestataireId: true, montantAttendu: true, echeance: true, fraisTransporteur: true },
    }),
    prisma.versementTransporteur.findMany({
      where: { annuleLe: null },
      select: { prestataireId: true, montantRecu: true, montantAttendu: true, dateVersement: true },
    }),
  ]);

  const parId = new Map<string, SyntheseTransporteur>(
    prestataires.map((p) => [
      p.id,
      { ...p, attendu: 0, nbARecevoir: 0, nbEnRetard: 0, montantEnRetard: 0, recuCeMois: 0, ecarts: 0, nbFraisInconnus: 0 },
    ])
  );
  for (const c of creances) {
    const t = parId.get(c.prestataireId);
    if (!t) continue;
    const attendu = Number(c.montantAttendu);
    t.attendu += attendu;
    t.nbARecevoir += 1;
    if (c.echeance < maintenant) {
      t.nbEnRetard += 1;
      t.montantEnRetard += attendu;
    }
    if (c.fraisTransporteur === null) t.nbFraisInconnus += 1;
  }
  const mois = debutDuMois(maintenant);
  for (const v of versements) {
    const t = parId.get(v.prestataireId);
    if (!t) continue;
    if (v.dateVersement >= mois) t.recuCeMois += Number(v.montantRecu);
    t.ecarts += Number(v.montantRecu) - Number(v.montantAttendu);
  }
  return [...parId.values()].map((t) => ({
    ...t,
    attendu: arrondi(t.attendu),
    montantEnRetard: arrondi(t.montantEnRetard),
    recuCeMois: arrondi(t.recuCeMois),
    ecarts: arrondi(t.ecarts),
  }));
}

export async function creancesARecevoir(prestataireId: string) {
  await synchroniserCreances();
  const creances = await prisma.creanceTransporteur.findMany({
    where: { prestataireId, etat: 'a_recevoir' },
    orderBy: { dateLivraison: 'asc' },
    select: {
      id: true,
      montantCod: true,
      fraisTransporteur: true,
      montantAttendu: true,
      dateLivraison: true,
      echeance: true,
      commande: {
        select: { id: true, codeSuivi: true, ville: true, clientNom: true, marchand: { select: { nomBoutique: true } } },
      },
    },
  });
  const maintenant = new Date();
  return creances.map((c) => ({
    id: c.id,
    commandeId: c.commande.id,
    codeSuivi: c.commande.codeSuivi,
    ville: c.commande.ville,
    clientNom: c.commande.clientNom,
    marchandNom: c.commande.marchand?.nomBoutique ?? null,
    montantCod: Number(c.montantCod),
    fraisTransporteur: c.fraisTransporteur === null ? null : Number(c.fraisTransporteur),
    montantAttendu: Number(c.montantAttendu),
    dateLivraison: c.dateLivraison,
    enRetard: c.echeance < maintenant,
  }));
}

export async function versementsDuTransporteur(prestataireId: string) {
  const versements = await prisma.versementTransporteur.findMany({
    where: { prestataireId },
    orderBy: { dateVersement: 'desc' },
    take: 50,
    // Jamais la photo dans une liste (base64) : seulement sa présence.
    omit: { preuveUrl: true },
    include: {
      auteur: { select: { nomComplet: true } },
      annulePar: { select: { nomComplet: true } },
      _count: { select: { creances: true } },
    },
  });
  const avecPreuve = new Set(
    (
      await prisma.versementTransporteur.findMany({
        where: { prestataireId, preuveUrl: { not: null } },
        select: { id: true },
      })
    ).map((v) => v.id)
  );
  return versements.map((v) => ({
    id: v.id,
    numero: v.numero,
    montantRecu: Number(v.montantRecu),
    montantAttendu: Number(v.montantAttendu),
    ecart: arrondi(Number(v.montantRecu) - Number(v.montantAttendu)),
    dateVersement: v.dateVersement,
    note: v.note,
    nbColis: v._count.creances,
    preuve: avecPreuve.has(v.id),
    auteur: v.auteur.nomComplet,
    annuleLe: v.annuleLe,
    annulePar: v.annulePar?.nomComplet ?? null,
  }));
}

// --- Écriture ---------------------------------------------------------------

export interface NouveauVersement {
  prestataireId: string;
  creanceIds: string[];
  montantRecu: number;
  dateVersement: Date;
  preuveUrl: string | null;
  note: string | null;
  auteurId: string;
}

export async function enregistrerVersement(v: NouveauVersement) {
  if (v.creanceIds.length === 0) throw new ApiError(400, 'Cochez au moins un colis');
  const prestataire = await prisma.prestataire.findUnique({ where: { id: v.prestataireId }, select: { nom: true } });
  if (!prestataire) throw new ApiError(404, 'Transporteur introuvable');

  return prisma.$transaction(async (tx) => {
    const creances = await tx.creanceTransporteur.findMany({
      where: { id: { in: v.creanceIds }, prestataireId: v.prestataireId, etat: 'a_recevoir' },
      select: { id: true, montantAttendu: true },
    });
    if (creances.length !== v.creanceIds.length) {
      throw new ApiError(409, 'Un ou plusieurs colis ne sont plus à recevoir chez ce transporteur — rechargez la page');
    }
    const attendu = arrondi(creances.reduce((n, c) => n + Number(c.montantAttendu), 0));

    const versement = await tx.versementTransporteur.create({
      data: {
        prestataireId: v.prestataireId,
        montantRecu: v.montantRecu,
        montantAttendu: attendu,
        dateVersement: v.dateVersement,
        preuveUrl: v.preuveUrl,
        note: v.note,
        auteurId: v.auteurId,
      },
      select: { id: true, numero: true },
    });

    // Verrou : seules des créances encore « à recevoir » passent payées.
    const { count } = await tx.creanceTransporteur.updateMany({
      where: { id: { in: v.creanceIds }, etat: 'a_recevoir' },
      data: { etat: 'paye', versementId: versement.id },
    });
    if (count !== creances.length) throw new ApiError(409, 'Ces colis viennent d’être marqués payés par quelqu’un d’autre');

    const transaction = await tx.transaction.create({
      data: {
        titre: `Versement ${prestataire.nom} n° ${versement.numero}`,
        montant: v.montantRecu,
        type: 'revenu',
        categorieId: await idCategorieSysteme(tx, 'encaissement_transporteur'),
        dateEffet: v.dateVersement,
        description:
          `${creances.length} colis — attendu ${attendu.toFixed(2)} DH, reçu ${v.montantRecu.toFixed(2)} DH` +
          (v.note ? ` — ${v.note}` : ''),
        // La photo du reçu reste sur le versement : la recopier ferait peser
        // deux fois le même base64.
        auteurId: v.auteurId,
      },
      select: { id: true },
    });
    await tx.versementTransporteur.update({ where: { id: versement.id }, data: { transactionId: transaction.id } });
    return { ...versement, attendu, nbColis: creances.length };
  });
}

export interface ModificationVersement {
  montantRecu?: number;
  dateVersement?: Date;
  note?: string | null;
  // undefined = inchangée, null = retirée, chaîne = nouvelle photo.
  preuveUrl?: string | null;
}

export async function modifierVersement(id: string, m: ModificationVersement) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.versementTransporteur.findUnique({
      where: { id },
      select: { id: true, annuleLe: true, transactionId: true, montantAttendu: true, note: true, numero: true },
    });
    if (!v) throw new ApiError(404, 'Versement introuvable');
    if (v.annuleLe) throw new ApiError(409, 'Ce versement est annulé : il ne se modifie plus');

    await tx.versementTransporteur.update({
      where: { id },
      data: {
        ...(m.montantRecu !== undefined && { montantRecu: m.montantRecu }),
        ...(m.dateVersement !== undefined && { dateVersement: m.dateVersement }),
        ...(m.note !== undefined && { note: m.note }),
        ...(m.preuveUrl !== undefined && { preuveUrl: m.preuveUrl }),
      },
    });
    // L'écriture du journal suit le montant et la date réellement reçus.
    if (v.transactionId && (m.montantRecu !== undefined || m.dateVersement !== undefined)) {
      await tx.transaction.update({
        where: { id: v.transactionId },
        data: {
          ...(m.montantRecu !== undefined && { montant: m.montantRecu }),
          ...(m.dateVersement !== undefined && { dateEffet: m.dateVersement }),
        },
      });
    }
  });
}

// Saisi par erreur : les colis redeviennent « à recevoir », l'écriture du
// journal est neutralisée par compensation (même mécanisme que
// POST /api/finance/[id]/annuler), le versement reste pour l'audit.
export async function annulerVersement(id: string, auteurId: string, motif: string | null) {
  return prisma.$transaction(async (tx) => {
    const verrou = await tx.versementTransporteur.updateMany({
      where: { id, annuleLe: null },
      data: { annuleLe: new Date(), annuleParId: auteurId },
    });
    if (verrou.count !== 1) throw new ApiError(409, 'Ce versement est déjà annulé, ou introuvable');

    const v = await tx.versementTransporteur.findUniqueOrThrow({
      where: { id },
      select: { numero: true, transaction: { select: { id: true, montant: true, titre: true, categorieId: true, estAnnulee: true } } },
    });
    await tx.creanceTransporteur.updateMany({
      where: { versementId: id, etat: 'paye' },
      data: { etat: 'a_recevoir', versementId: null },
    });
    if (v.transaction && !v.transaction.estAnnulee) {
      await tx.transaction.update({ where: { id: v.transaction.id }, data: { estAnnulee: true } });
      await tx.transaction.create({
        data: {
          montant: v.transaction.montant,
          type: 'depense',
          titre: `Neutralisation — ${v.transaction.titre}`.slice(0, LONGUEUR_MAX_TITRE),
          categorieId: v.transaction.categorieId,
          dateEffet: new Date(),
          description: `Annulation du versement transporteur n° ${v.numero}${motif ? ` — ${motif}` : ''}`,
          auteurId,
          transactionOrigineId: v.transaction.id,
        },
      });
    }
  });
}

// --- Argent d'un colis (fiche colis) ----------------------------------------

export async function argentDuColis(commandeId: string) {
  await synchroniserCreancesSansErreur([commandeId]);
  const c = await prisma.creanceTransporteur.findUnique({
    where: { commandeId },
    select: {
      montantCod: true,
      fraisTransporteur: true,
      montantAttendu: true,
      dateLivraison: true,
      echeance: true,
      etat: true,
      prestataire: { select: { nom: true } },
      versement: { select: { numero: true, dateVersement: true, annuleLe: true } },
    },
  });
  if (!c) return null;
  return {
    transporteur: c.prestataire.nom,
    montantCod: Number(c.montantCod),
    fraisTransporteur: c.fraisTransporteur === null ? null : Number(c.fraisTransporteur),
    montantAttendu: Number(c.montantAttendu),
    dateLivraison: c.dateLivraison,
    etat: c.etat === 'a_recevoir' && c.echeance < new Date() ? 'en_retard' : c.etat,
    versement: c.versement && !c.versement.annuleLe ? { numero: c.versement.numero, date: c.versement.dateVersement } : null,
  };
}
