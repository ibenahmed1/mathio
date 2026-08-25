import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { nextFactureNumero } from '@/lib/codes';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutFacture } from '@/app/generated/prisma/enums';

// § Facturation marchand (/admin/factures).
//
// Symétrique de lib/bon-paiement.ts, qui calcule ce que la plateforme DOIT au
// livreur : ce module calcule ce que la plateforme doit au MARCHAND, à partir
// de sa propre grille tarifaire (TarifMarchandVille, repli sur
// Marchand.fraisLivraison / fraisRetour). Les deux grilles sont indépendantes
// — leur différence est la marge, et la garder explicite est un choix assumé
// du modèle.
//
// Le document suit le même cycle que la paie livreur : brouillon (tout est
// modifiable, les colis sont déjà réservés) → émise (montants figés) → payée
// (l'argent est sorti). Les frais annexes sont l'exact pendant des
// ajustements du bon de paiement.

// Seuls ces deux statuts sont facturables : ils sont les seuls TERMINAUX qui
// engagent une prestation réellement rendue. Un colis encore en relance, en
// tournée ou annulé avant expédition ne se facture pas — et un colis
// `retourne_au_hub` attend encore sa restitution au marchand (§ Bon de
// retour), donc il n'est pas non plus facturable tant que la boucle n'est pas
// fermée.
const STATUTS_FACTURABLES = ['livre', 'retourne'] as const;

// Statuts qui « occupent » un colis. Une facture annulée n'en fait pas partie :
// ses lignes sont supprimées à l'annulation, ce qui rend les colis de nouveau
// facturables — c'est tout l'objet de l'annulation.
export const STATUTS_FACTURE_ACTIFS: StatutFacture[] = ['brouillon', 'emise', 'payee'];

const colisFacturableInclude = {
  villeRef: { select: { id: true, nom: true } },
} satisfies Prisma.CommandeInclude;

export type ColisFacturable = Prisma.CommandeGetPayload<{ include: typeof colisFacturableInclude }>;

export interface TarifsMarchand {
  parVilleId: Map<string, { livraison: number; retour: number }>;
  defautLivraison: number;
  defautRetour: number;
}

const marchandTarifSelect = {
  id: true,
  fraisLivraison: true,
  fraisRetour: true,
} satisfies Prisma.MarchandSelect;

type MarchandTarif = Prisma.MarchandGetPayload<{ select: typeof marchandTarifSelect }>;

function arrondi(valeur: number): number {
  return Number(valeur.toFixed(2));
}

// ------------------------------------------------------------
// Grille tarifaire
// ------------------------------------------------------------

// Résolution en UNE requête pour toute la facture, puis lecture en mémoire
// colis par colis — même stratégie que getTarifsLivreur (lib/bon-distribution.ts) :
// une facture peut porter plusieurs centaines de colis, une requête par ligne
// serait ruineuse.
export async function getTarifsMarchand(marchand: MarchandTarif): Promise<TarifsMarchand> {
  const tarifs = await prisma.tarifMarchandVille.findMany({
    where: { marchandId: marchand.id },
    select: { villeId: true, fraisLivraison: true, fraisRetour: true },
  });

  return {
    parVilleId: new Map(
      tarifs.map((t) => [t.villeId, { livraison: Number(t.fraisLivraison), retour: Number(t.fraisRetour) }])
    ),
    defautLivraison: marchand.fraisLivraison ? Number(marchand.fraisLivraison) : 0,
    defautRetour: marchand.fraisRetour ? Number(marchand.fraisRetour) : 0,
  };
}

// `villeId` est nullable : Commande.ville reste un champ texte libre et sa
// résolution vers le référentiel Ville est best-effort (cf. normaliserVille,
// lib/hub-stock.ts). Un colis non résolu retombe sur le tarif par défaut du
// marchand plutôt que d'échouer — facturer 0 serait pire que facturer le
// tarif de base.
export function tarifPourColis(
  tarifs: TarifsMarchand,
  villeId: string | null,
  type: 'livraison' | 'retour'
): number {
  const surcharge = villeId ? tarifs.parVilleId.get(villeId) : undefined;
  if (surcharge) return type === 'livraison' ? surcharge.livraison : surcharge.retour;
  return type === 'livraison' ? tarifs.defautLivraison : tarifs.defautRetour;
}

// ------------------------------------------------------------
// Assiette facturable
// ------------------------------------------------------------

// Colis facturables d'un marchand : terminaux, jamais encore facturés (ni par
// l'état de paiement, ni par une ligne de facture existante). La double
// condition est volontaire — `etatPaiement` est modifiable à la main par
// l'admin (§ PATCH /api/commandes/[id]/paiement) alors que LigneFacture.commandeId
// porte une contrainte d'unicité en base : l'une est le filtre d'usage,
// l'autre le garde-fou.
//
// `factureId` élargit l'assiette aux colis DÉJÀ pris par cette facture-là :
// c'est ce qui permet de rouvrir un brouillon et d'y remettre un colis qu'on
// venait d'en retirer, sans quoi tout retrait serait définitif.
export async function getColisFacturables(
  marchandId: string,
  factureId?: string
): Promise<ColisFacturable[]> {
  return prisma.commande.findMany({
    where: {
      marchandId,
      statut: { in: [...STATUTS_FACTURABLES] },
      OR: [
        { etatPaiement: 'non_paye', ligneFacture: null },
        ...(factureId ? [{ ligneFacture: { factureId } }] : []),
      ],
    },
    include: colisFacturableInclude,
    orderBy: [{ dateLivraison: 'asc' }, { codeSuivi: 'asc' }],
  });
}

// § Étape 1 de /admin/factures/nouvelle — « Clients à facturer ».
//
// Écran d'entrée du module : les marchands qui ont de la matière, avec de quoi
// décider lequel traiter sans ouvrir chaque fiche. Trois requêtes fixes et non
// une par marchand : la liste est courte à l'écran mais l'assiette derrière
// peut porter des milliers de colis.
export interface MarchandAFacturer {
  marchandId: string;
  nomBoutique: string;
  raisonSociale: string | null;
  ville: string | null;
  nbColisLivres: number;
  nbColisRetournes: number;
  // COD des colis LIVRÉS uniquement : un colis retourné n'a rien encaissé.
  // Sommer les deux gonflerait le « à reverser » d'un montant qui n'existe pas.
  totalCod: number;
  // Le plus ancien colis en attente : c'est lui qui dit l'urgence, bien mieux
  // qu'un volume. Un marchand avec 3 colis qui attendent depuis six semaines
  // passe avant un marchand avec 200 colis d'hier.
  attenteDepuis: string | null;
}

export async function getMarchandsAFacturer(): Promise<MarchandAFacturer[]> {
  const facturable = {
    statut: { in: [...STATUTS_FACTURABLES] },
    etatPaiement: 'non_paye',
    ligneFacture: null,
  } satisfies Prisma.CommandeWhereInput;

  const groupes = await prisma.commande.groupBy({
    by: ['marchandId', 'statut'],
    where: facturable,
    _count: { _all: true },
    _sum: { montantCod: true },
    _min: { dateLivraison: true },
  });

  if (groupes.length === 0) return [];

  const marchands = await prisma.marchand.findMany({
    where: { id: { in: [...new Set(groupes.map((g) => g.marchandId))] } },
    select: { id: true, nomBoutique: true, raisonSociale: true, ville: true },
  });
  const parId = new Map(marchands.map((m) => [m.id, m]));

  const lignes = new Map<string, MarchandAFacturer>();

  for (const g of groupes) {
    const fiche = parId.get(g.marchandId);
    const ligne = lignes.get(g.marchandId) ?? {
      marchandId: g.marchandId,
      nomBoutique: fiche?.nomBoutique ?? '—',
      raisonSociale: fiche?.raisonSociale ?? null,
      ville: fiche?.ville ?? null,
      nbColisLivres: 0,
      nbColisRetournes: 0,
      totalCod: 0,
      attenteDepuis: null,
    };

    if (g.statut === 'livre') {
      ligne.nbColisLivres += g._count._all;
      ligne.totalCod = arrondi(ligne.totalCod + Number(g._sum.montantCod ?? 0));
    } else {
      ligne.nbColisRetournes += g._count._all;
    }

    const plusAncien = g._min.dateLivraison;
    if (plusAncien && (!ligne.attenteDepuis || plusAncien < new Date(ligne.attenteDepuis))) {
      ligne.attenteDepuis = plusAncien.toISOString();
    }

    lignes.set(g.marchandId, ligne);
  }

  // Tri par COD en attente décroissant : c'est l'argent qui dort chez la
  // plateforme, donc le premier critère du comptable.
  return [...lignes.values()].sort((a, b) => b.totalCod - a.totalCod);
}

// ------------------------------------------------------------
// Calcul
// ------------------------------------------------------------

export interface LigneCalculee {
  commandeId: string;
  livre: boolean;
  montantCod: number;
  frais: number;
}

export interface FraisAnnexeSaisi {
  libelle: string;
  montant: number;
}

export interface FactureCalculee {
  lignes: LigneCalculee[];
  nbColisLivres: number;
  nbColisRetournes: number;
  totalCod: number;
  totalFraisLivraison: number;
  totalFraisRetour: number;
  totalAutresFrais: number;
  netAPayer: number;
}

// Cœur du calcul, volontairement PUR (aucune requête) pour être testable et
// pour servir à la fois à la prévisualisation côté écran et à la création
// réelle — les deux doivent donner le même chiffre au centime près.
//
// Arrondi à 2 décimales à chaque étape plutôt qu'une seule fois à la fin : les
// montants stockés sont des Decimal(12,2) et le total doit être exactement la
// somme des lignes imprimées, sans dérive d'un centime.
export function calculerFacture(
  colis: ColisFacturable[],
  tarifs: TarifsMarchand,
  autresFrais: FraisAnnexeSaisi[] = []
): FactureCalculee {
  const lignes: LigneCalculee[] = [];
  let totalCod = 0;
  let totalFraisLivraison = 0;
  let totalFraisRetour = 0;
  let nbColisLivres = 0;
  let nbColisRetournes = 0;

  for (const c of colis) {
    const livre = c.statut === 'livre';
    const villeId = c.villeId ?? null;
    const frais = arrondi(tarifPourColis(tarifs, villeId, livre ? 'livraison' : 'retour'));
    // Un colis retourné n'a rien encaissé : son COD ne doit jamais entrer
    // dans le total, seulement ses frais de retour.
    const montantCod = livre ? arrondi(Number(c.montantCod)) : 0;

    if (livre) {
      nbColisLivres += 1;
      totalCod = arrondi(totalCod + montantCod);
      totalFraisLivraison = arrondi(totalFraisLivraison + frais);
    } else {
      nbColisRetournes += 1;
      totalFraisRetour = arrondi(totalFraisRetour + frais);
    }

    lignes.push({ commandeId: c.id, livre, montantCod, frais });
  }

  const totalAutresFrais = arrondi(
    autresFrais.reduce((somme, f) => somme + Math.abs(f.montant), 0)
  );

  return {
    lignes,
    nbColisLivres,
    nbColisRetournes,
    totalCod,
    totalFraisLivraison,
    totalFraisRetour,
    totalAutresFrais,
    // Peut être négatif quand les frais dépassent le COD encaissé : c'est
    // alors le marchand qui doit à la plateforme. Le signe est conservé tel
    // quel, jamais ramené à 0 — le masquer ferait disparaître une dette.
    netAPayer: arrondi(totalCod - totalFraisLivraison - totalFraisRetour - totalAutresFrais),
  };
}

// Prévisualisation affichée dans l'écran d'édition (§ /admin/factures/nouvelle
// et /admin/factures/[id]/modifier) : mêmes chiffres que ceux qui seront figés.
//
// Le calcul porte sur TOUTE l'assiette et non sur une sélection : l'écran a
// besoin du tarif de chaque colis pour recalculer le net à chaque case
// décochée, sans repasser par le réseau. La sélection retenue est décidée
// côté client, puis revalidée côté serveur à l'enregistrement — c'est le
// chiffre serveur qui fait foi.
//
// `factureId` élargit l'assiette aux colis déjà pris par CETTE facture, ce qui
// permet de rouvrir un brouillon avec la totalité de son contexte.
export async function previsualiserFacture(marchandId: string, factureId?: string) {
  const marchand = await prisma.marchand.findUnique({
    where: { id: marchandId },
    select: { ...marchandTarifSelect, nomBoutique: true, raisonSociale: true, ville: true },
  });
  if (!marchand) throw new ApiError(404, 'Marchand introuvable');

  const [facturables, tarifs] = await Promise.all([
    getColisFacturables(marchandId, factureId),
    getTarifsMarchand(marchand),
  ]);

  return {
    marchand: {
      id: marchand.id,
      nomBoutique: marchand.nomBoutique,
      raisonSociale: marchand.raisonSociale,
      ville: marchand.ville,
    },
    colis: facturables,
    total: calculerFacture(facturables, tarifs),
  };
}

// ------------------------------------------------------------
// Écriture : sélection de colis et frais annexes
// ------------------------------------------------------------

// Normalise les frais annexes reçus du client. Le montant est toujours ramené
// en POSITIF : un frais est par nature à la charge du marchand, et accepter un
// « −200 » ouvrirait une porte dérobée pour créditer un marchand sans trace —
// exactement ce que le type `prime`/`penalite` évite côté livreur.
export function parseFraisAnnexes(brut: unknown): FraisAnnexeSaisi[] {
  if (brut === undefined || brut === null) return [];
  if (!Array.isArray(brut)) throw new ApiError(400, 'autresFrais doit être une liste');

  return brut.map((f, i) => {
    const libelle = typeof f?.libelle === 'string' ? f.libelle.trim() : '';
    if (!libelle) throw new ApiError(400, `Le libellé du frais n° ${i + 1} est obligatoire`);

    const montant = Number(f?.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      throw new ApiError(400, `Le montant du frais « ${libelle} » doit être strictement positif`);
    }

    return { libelle, montant: arrondi(Math.abs(montant)) };
  });
}

// Recalcule les six totaux dénormalisés à partir des lignes EN BASE. Appelé
// après chaque modification, DANS la transaction : les totaux portés par la
// facture ne doivent jamais diverger de la somme de ses lignes, sinon le
// document imprimé ment.
export async function recalculerTotaux(db: Prisma.TransactionClient, factureId: string) {
  const [lignes, frais] = await Promise.all([
    db.ligneFacture.findMany({
      where: { factureId },
      select: { livre: true, montantCod: true, frais: true },
    }),
    db.fraisFacture.findMany({ where: { factureId }, select: { montant: true } }),
  ]);

  let nbColisLivres = 0;
  let nbColisRetournes = 0;
  let totalCod = 0;
  let totalFraisLivraison = 0;
  let totalFraisRetour = 0;

  for (const l of lignes) {
    if (l.livre) {
      nbColisLivres += 1;
      totalCod = arrondi(totalCod + Number(l.montantCod));
      totalFraisLivraison = arrondi(totalFraisLivraison + Number(l.frais));
    } else {
      nbColisRetournes += 1;
      totalFraisRetour = arrondi(totalFraisRetour + Number(l.frais));
    }
  }

  const totalAutresFrais = arrondi(frais.reduce((s, f) => s + Number(f.montant), 0));

  return db.facture.update({
    where: { id: factureId },
    data: {
      nbColisLivres,
      nbColisRetournes,
      totalCod,
      totalFraisLivraison,
      totalFraisRetour,
      totalAutresFrais,
      netAPayer: arrondi(totalCod - totalFraisLivraison - totalFraisRetour - totalAutresFrais),
    },
  });
}

// Remplace INTÉGRALEMENT la sélection de colis d'une facture : les lignes
// actuelles sont supprimées et leurs colis libérés, puis la nouvelle sélection
// est réécrite. Écrire un delta (ajouts/retraits) serait plus économe mais
// beaucoup plus facile à faire diverger — et le volume en jeu (quelques
// centaines de lignes, dans une transaction) ne le justifie pas.
//
// L'unicité de LigneFacture.commandeId fait échouer toute la transaction si un
// colis a été pris par une autre facture entre-temps : c'est le vrai garde-fou
// anti-double-facturation, la revalidation côté route n'étant qu'un filtre de
// confort.
export async function ecrireSelection(
  tx: Prisma.TransactionClient,
  options: {
    factureId: string;
    colis: ColisFacturable[];
    tarifs: TarifsMarchand;
    autresFrais: FraisAnnexeSaisi[];
    auteurId: string;
  }
) {
  const { factureId, colis, tarifs, autresFrais, auteurId } = options;

  // 1. Libérer ce que la facture tenait déjà.
  const anciennes = await tx.ligneFacture.findMany({
    where: { factureId },
    select: { commandeId: true },
  });
  if (anciennes.length > 0) {
    await tx.ligneFacture.deleteMany({ where: { factureId } });
    await tx.commande.updateMany({
      where: { id: { in: anciennes.map((l) => l.commandeId) } },
      data: { etatPaiement: 'non_paye' },
    });
  }

  // 2. Réserver la nouvelle sélection.
  const calcul = calculerFacture(colis, tarifs, autresFrais);
  if (calcul.lignes.length > 0) {
    await tx.ligneFacture.createMany({
      data: calcul.lignes.map((l) => ({ ...l, factureId })),
    });
    await tx.commande.updateMany({
      where: { id: { in: calcul.lignes.map((l) => l.commandeId) } },
      // Réservé dès le BROUILLON, et pas seulement à l'émission : sans ça,
      // deux comptables préparant le même marchand en parallèle croiraient
      // chacun disposer de tous les colis, et le second verrait sa facture
      // échouer au dernier moment sur la contrainte d'unicité.
      data: { etatPaiement: 'facture' },
    });
  }

  // 3. Réécrire les frais annexes.
  await tx.fraisFacture.deleteMany({ where: { factureId } });
  if (autresFrais.length > 0) {
    await tx.fraisFacture.createMany({
      data: autresFrais.map((f) => ({ factureId, libelle: f.libelle, montant: f.montant, creeParId: auteurId })),
    });
  }

  return recalculerTotaux(tx, factureId);
}

// Crée une facture en BROUILLON et y écrit la sélection. Le passage immédiat à
// `emise` ou `payee` est décidé par la route appelante — c'est elle qui sait
// si l'utilisateur a cliqué « enregistrer » ou « émettre ».
export async function creerFacture(
  tx: Prisma.TransactionClient,
  options: {
    marchandId: string;
    colis: ColisFacturable[];
    tarifs: TarifsMarchand;
    autresFrais: FraisAnnexeSaisi[];
    emiseParId: string;
  }
) {
  const creee = await tx.facture.create({
    data: {
      numero: await nextFactureNumero(tx),
      marchandId: options.marchandId,
      statut: 'brouillon',
      // Totaux provisoires : ecrireSelection les réécrit juste après, à partir
      // des lignes réellement insérées.
      nbColisLivres: 0,
      nbColisRetournes: 0,
      totalCod: 0,
      totalFraisLivraison: 0,
      totalFraisRetour: 0,
      totalAutresFrais: 0,
      netAPayer: 0,
      emiseParId: options.emiseParId,
    },
  });

  return ecrireSelection(tx, {
    factureId: creee.id,
    colis: options.colis,
    tarifs: options.tarifs,
    autresFrais: options.autresFrais,
    auteurId: options.emiseParId,
  });
}

// ------------------------------------------------------------
// Règlement
// ------------------------------------------------------------

// Un virement ou un chèque sans référence n'est pas vérifiable le jour d'une
// contestation : le marchand dit « je n'ai rien reçu », et la plateforme n'a
// qu'un booléen à opposer. Les espèces font exception — la trace, c'est la
// signature sur le reçu papier. Même règle que le règlement du livreur.
export const MODES_REGLEMENT = ['virement', 'especes', 'cheque'] as const;
export type ModeReglement = (typeof MODES_REGLEMENT)[number];
const MODES_AVEC_REFERENCE: ModeReglement[] = ['virement', 'cheque'];

export function parseReglement(body: { modeReglement?: unknown; referenceReglement?: unknown }) {
  const modeReglement = body.modeReglement as ModeReglement;
  if (!MODES_REGLEMENT.includes(modeReglement)) {
    throw new ApiError(400, 'Mode de règlement invalide (virement, especes ou cheque)');
  }

  const referenceReglement =
    typeof body.referenceReglement === 'string' ? body.referenceReglement.trim() : '';
  if (MODES_AVEC_REFERENCE.includes(modeReglement) && !referenceReglement) {
    throw new ApiError(400, 'La référence du virement ou du chèque est obligatoire');
  }

  return { modeReglement, referenceReglement: referenceReglement || null };
}

// Passe une facture à `payee` : écriture comptable de SORTIE de caisse, colis
// à l'état de paiement `paye`, mode et référence du reversement figés.
// Exactement le pendant du décaissement du bon de paiement, mais en catégorie
// `paiement_client`.
//
// Le montant réglé est le `netAPayer` porté par la facture, jamais recalculé
// ni saisi : ce qui a été facturé est ce qui est dû.
export async function reglerFacture(
  tx: Prisma.TransactionClient,
  options: {
    factureId: string;
    auteurId: string;
    modeReglement: ModeReglement;
    referenceReglement: string | null;
    date?: Date;
  }
) {
  const { factureId, auteurId, modeReglement, referenceReglement } = options;
  const now = options.date ?? new Date();

  const facture = await tx.facture.findUniqueOrThrow({
    where: { id: factureId },
    select: {
      numero: true,
      netAPayer: true,
      nbColisLivres: true,
      nbColisRetournes: true,
      marchand: { select: { nomBoutique: true } },
    },
  });

  const netAPayer = Number(facture.netAPayer);

  // Un net à payer négatif signifie que le marchand doit à la plateforme :
  // l'écriture s'inverse alors en recette, sans quoi le journal comptable
  // enregistrerait une sortie de caisse qui n'a jamais eu lieu.
  const transaction = await tx.transaction.create({
    data: {
      montant: Math.abs(netAPayer),
      type: netAPayer >= 0 ? 'depense' : 'revenu',
      categorie: 'paiement_client',
      dateEffet: now,
      description: `Règlement facture ${facture.numero} — ${facture.marchand.nomBoutique} (${facture.nbColisLivres} livré(s), ${facture.nbColisRetournes} retourné(s))`,
      auteurId,
    },
  });

  await tx.commande.updateMany({
    where: { ligneFacture: { factureId } },
    data: { etatPaiement: 'paye' },
  });

  return tx.facture.update({
    where: { id: factureId },
    data: {
      statut: 'payee',
      datePaiement: now,
      modeReglement,
      referenceReglement,
      transactionId: transaction.id,
    },
    include: { marchand: { select: { nomBoutique: true } } },
  });
}

// ------------------------------------------------------------
// Lecture d'une facture
// ------------------------------------------------------------

export const factureDetailInclude = {
  marchand: {
    select: {
      id: true,
      nomBoutique: true,
      raisonSociale: true,
      iceRc: true,
      ville: true,
      adresse: true,
      rib: true,
      utilisateur: { select: { nomComplet: true, telephone: true, email: true } },
    },
  },
  emisePar: { select: { nomComplet: true } },
  validePar: { select: { nomComplet: true } },
  transaction: { select: { id: true, dateEffet: true, montant: true } },
  fraisAnnexes: {
    select: {
      id: true,
      libelle: true,
      montant: true,
      dateCreation: true,
      creePar: { select: { nomComplet: true } },
    },
    orderBy: { dateCreation: 'asc' },
  },
  lignes: {
    include: {
      commande: {
        select: {
          id: true,
          codeSuivi: true,
          clientNom: true,
          clientTelephone: true,
          ville: true,
          statut: true,
          dateLivraison: true,
        },
      },
    },
    orderBy: { commande: { codeSuivi: 'asc' } },
  },
} satisfies Prisma.FactureInclude;

export async function getFacture(id: string) {
  const facture = await prisma.facture.findUnique({ where: { id }, include: factureDetailInclude });
  if (!facture) throw new ApiError(404, 'Facture introuvable');
  return facture;
}
