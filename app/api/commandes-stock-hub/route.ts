import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { sessionHasPermission } from '@/lib/auth';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommandeStockHub } from '@/app/generated/prisma/enums';
import {
  STATUTS_COMMANDE_STOCK_HUB,
  STATUTS_CREATION_COMMANDE_STOCK_HUB,
  STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT,
} from '@/lib/commandes-stock-hub';
import { analyserPreuveComptable, dataUrlPreuve } from '@/lib/finance';
import { verifierCategorie } from '@/lib/journal-comptable';

// § Comptabilité — même périmètre d'accès que /api/finance (admin/responsable
// uniquement, cf. app/api/finance/route.ts).
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

// Adresse du justificatif d'une commande, telle qu'exposée au client. Le contenu
// ne voyage jamais dans le JSON de la liste : il est servi à la demande par
// app/api/commandes-stock-hub/[id]/preuve/route.ts, sous les mêmes droits.
function cheminPreuve(id: string): string {
  return `/api/commandes-stock-hub/${id}/preuve`;
}

const INCLUDE_COMMANDE = {
  auteur: { select: { nomComplet: true, role: true } },
  supprimePar: { select: { nomComplet: true } },
  categorie: { select: { id: true, nom: true } },
} as const;

type CommandeLue = Prisma.CommandeStockHubGetPayload<{ include: typeof INCLUDE_COMMANDE; omit: { preuveUrl: true } }>;

// Montant en nombre : un Decimal brut ne doit pas atteindre le JSON.
function exposerCommande(c: CommandeLue, preuve: string | null) {
  return {
    id: c.id,
    numero: c.numero,
    titre: c.titre,
    sousTitre: c.sousTitre,
    montant: Number(c.montant),
    statut: c.statut,
    modePaiement: c.modePaiement,
    dateCommande: c.dateCommande,
    categorie: c.categorie,
    auteur: c.auteur,
    dateCreation: c.dateCreation,
    supprimeLe: c.supprimeLe,
    supprimePar: c.supprimePar,
    preuve,
  };
}

// Même règle que le journal (§ app/api/finance/route.ts, SANS_CACHE) : une
// lecture de la comptabilité ne se sert pas depuis un cache.
const SANS_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);

    // `?supprimees=1` : la corbeille, réservée à qui peut restaurer — même
    // règle que le journal (app/api/finance/route.ts).
    const supprimees = request.nextUrl.searchParams.get('supprimees') === '1';
    if (supprimees && !sessionHasPermission(session, 'comptabilite:delete')) {
      throw new ApiError(403, 'Accès refusé : permission manquante');
    }

    const statut = request.nextUrl.searchParams.get('statut');
    const where: Prisma.CommandeStockHubWhereInput = { supprimeLe: supprimees ? { not: null } : null };
    if (statut) {
      if (!STATUTS_COMMANDE_STOCK_HUB.includes(statut as StatutCommandeStockHub)) {
        throw new ApiError(400, 'Statut invalide');
      }
      where.statut = statut as StatutCommandeStockHub;
    }

    const [commandes, idsAvecPreuve] = await Promise.all([
      prisma.commandeStockHub.findMany({
        where,
        orderBy: { dateCommande: 'desc' },
        // `omit` DANS la requête : la colonne porte la photo ENTIÈRE du
        // justificatif en base64 (§ CommandeStockHub.preuveUrl). La liste des
        // commandes n'en affiche qu'une vignette cliquable, elle n'a aucune
        // raison de transporter les fichiers.
        omit: { preuveUrl: true },
        include: INCLUDE_COMMANDE,
      }),
      // Savoir QU'UN justificatif existe ne demande pas de le lire : cette
      // requête ne ramène que des identifiants.
      prisma.commandeStockHub.findMany({
        where: { ...where, preuveUrl: { not: null } },
        select: { id: true },
      }),
    ]);

    const avecPreuve = new Set(idsAvecPreuve.map((c) => c.id));

    return NextResponse.json(
      {
        // Un POINTEUR vers la route de contenu, jamais l'octet. `null` quand la
        // commande n'a pas de justificatif — la carte n'affiche alors rien.
        data: commandes.map((c) => exposerCommande(c, avecPreuve.has(c.id) ? cheminPreuve(c.id) : null)),
      },
      { headers: SANS_CACHE }
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);
    const body = await request.json();

    const titre = typeof body.titre === 'string' ? body.titre.trim() : '';
    const sousTitre = typeof body.sousTitre === 'string' && body.sousTitre.trim() ? body.sousTitre.trim() : null;
    const montant = Number(body.montant);
    const statut = (
      typeof body.statut === 'string' ? body.statut : STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT
    ) as StatutCommandeStockHub;
    const modePaiement = typeof body.modePaiement === 'string' ? body.modePaiement.trim() : '';
    const dateCommandeRaw = typeof body.dateCommande === 'string' ? body.dateCommande : null;

    if (!titre || !modePaiement || !dateCommandeRaw) {
      throw new ApiError(400, 'Titre, mode de paiement et date de commande sont requis');
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      throw new ApiError(400, 'Le montant doit être strictement positif');
    }
    // « Annulée » est refusée ici : elle ne s'atteint que par PATCH, depuis un
    // brouillon ou une commande passée (cf. STATUTS_CREATION_COMMANDE_STOCK_HUB).
    if (!STATUTS_CREATION_COMMANDE_STOCK_HUB.includes(statut)) {
      throw new ApiError(400, 'Statut invalide à la création');
    }
    const dateCommande = new Date(dateCommandeRaw);
    if (Number.isNaN(dateCommande.getTime())) {
      throw new ApiError(400, 'Date de commande invalide');
    }
    // Catégorie FACULTATIVE (§ CommandeStockHub.categorieId), mais si elle est
    // fournie elle doit être une catégorie de commande, pas d'écriture.
    const categorieId =
      typeof body.categorieId === 'string' && body.categorieId
        ? (await verifierCategorie(prisma, body.categorieId, 'commande_stock_hub')).id
        : null;

    // Justificatif photo FACULTATIF (§ CommandeStockHub.preuveUrl) : une
    // commande sans facture jointe est valide — le fournisseur ne l'a pas
    // toujours remise au moment de la saisie. Une preuve fournie, en revanche,
    // est validée avant d'entrer en base, et stockée sous sa forme normalisée.
    const preuveBrute = typeof body.preuveUrl === 'string' ? body.preuveUrl.trim() : '';
    let preuveUrl: string | null = null;
    if (preuveBrute) {
      const analyse = analyserPreuveComptable(preuveBrute);
      if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
      preuveUrl = dataUrlPreuve(analyse.preuve);
    }

    const commande = await prisma.commandeStockHub.create({
      data: {
        titre,
        sousTitre,
        montant,
        statut,
        modePaiement,
        dateCommande,
        categorieId,
        preuveUrl,
        auteurId: session.sub,
      },
      // La photo ne repart pas dans la réponse qui vient de l'écrire : le client
      // l'a déjà, et la liste ne travaille que sur le pointeur.
      omit: { preuveUrl: true },
      include: INCLUDE_COMMANDE,
    });

    return NextResponse.json(exposerCommande(commande, preuveUrl ? cheminPreuve(commande.id) : null), {
      status: 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}
