import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { sessionHasPermission } from '@/lib/auth';
import type { Prisma } from '@/app/generated/prisma/client';
import {
  analyserDate,
  analyserMontant,
  analyserPreuveComptable,
  analyserTitre,
  dataUrlPreuve,
  estTypeTransaction,
  texteFacultatif,
} from '@/lib/finance';
import { verifierCategorie } from '@/lib/journal-comptable';

// § Comptabilité — Droits d'accès & sécurité (RBAC) : création et consultation
// réservées à admin (SUPER_ADMIN/ADMIN) et responsable (responsable comptable
// côté rôles existants, cf. TarifsVilleModal/paiement qui suit la même
// convention). Aucun autre rôle back-office (superviseur, moderateur,
// equipe_suivi) ni rôle Kanban/marchand/terrain n'y accède.
const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

// Adresse du justificatif d'une écriture, telle qu'exposée au client. Le
// contenu ne voyage jamais dans le JSON du journal : il est servi à la demande
// par app/api/finance/[id]/preuve/route.ts, sous les mêmes droits.
function cheminPreuve(id: string): string {
  return `/api/finance/${id}/preuve`;
}

// Ce qu'une ligne du journal montre de sa catégorie et de son origine. Les
// relations d'origine (tournée, facture, paie) disent à l'écran qu'une écriture
// est AUTOMATIQUE : la modifier ne recalcule pas le document qui l'a produite,
// et le comptable doit le lire avant de valider (§ Transaction).
const INCLUDE_LIGNE_JOURNAL = {
  auteur: { select: { nomComplet: true, role: true } },
  supprimePar: { select: { nomComplet: true } },
  categorie: { select: { id: true, nom: true } },
  bonDistribution: { select: { numero: true } },
  factureReglee: { select: { numero: true } },
  bonPaiement: { select: { numero: true } },
} as const;

type LigneJournal = Prisma.TransactionGetPayload<{ include: typeof INCLUDE_LIGNE_JOURNAL; omit: { preuveUrl: true } }>;

function origine(t: LigneJournal): { type: 'tournee' | 'facture' | 'paie'; numero: string } | null {
  if (t.bonDistribution) return { type: 'tournee', numero: t.bonDistribution.numero };
  if (t.factureReglee) return { type: 'facture', numero: t.factureReglee.numero };
  if (t.bonPaiement) return { type: 'paie', numero: t.bonPaiement.numero };
  return null;
}

// Champs listés un à un plutôt qu'un `...t` : ce qui sort vers l'écran se
// décide ici, pas au gré des colonnes qu'on ajoutera au modèle. Montant en
// nombre — un Decimal brut ne doit pas atteindre le JSON.
function exposerLigne(t: LigneJournal, preuve: string | null) {
  return {
    id: t.id,
    titre: t.titre,
    montant: Number(t.montant),
    type: t.type,
    categorie: t.categorie,
    dateEffet: t.dateEffet,
    description: t.description,
    estAnnulee: t.estAnnulee,
    transactionOrigineId: t.transactionOrigineId,
    auteur: t.auteur,
    dateCreation: t.dateCreation,
    supprimeLe: t.supprimeLe,
    supprimePar: t.supprimePar,
    origine: origine(t),
    preuve,
  };
}

// Un total comptable ne se sert JAMAIS depuis un cache. Sans cet en-tête, la
// réponse n'en portait aucun : le navigateur était libre d'appliquer son cache
// heuristique, et les deux cartes de l'écran demandant la MÊME url, le rapport
// de trésorerie pouvait recevoir la copie d'une réponse antérieure pendant que
// le journal recevait la version fraîche — un solde qui ne bougeait pas après
// une neutralisation. Vaut aussi pour tout proxy ou tunnel placé devant l'app.
const SANS_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);

    const type = request.nextUrl.searchParams.get('type');
    const categorieId = request.nextUrl.searchParams.get('categorieId');
    // `?supprimees=1` : la corbeille, d'où l'on restaure. Elle n'a de sens que
    // pour qui peut restaurer, et elle montre ce qui a été retiré du journal —
    // réservée donc à `comptabilite:delete`, le proxy n'exigeant que la lecture
    // sur un GET.
    const supprimees = request.nextUrl.searchParams.get('supprimees') === '1';
    if (supprimees && !sessionHasPermission(session, 'comptabilite:delete')) {
      throw new ApiError(403, 'Accès refusé : permission manquante');
    }

    const where: Prisma.TransactionWhereInput = { supprimeLe: supprimees ? { not: null } : null };
    if (type) {
      if (!estTypeTransaction(type)) throw new ApiError(400, 'Type de transaction invalide');
      where.type = type;
    }
    if (categorieId) where.categorieId = categorieId;

    const [transactions, idsAvecPreuve, totaux] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { dateEffet: 'desc' },
        // `omit` DANS la requête, et non un tri de la réponse après coup : la
        // colonne porte la photo ENTIÈRE du justificatif en base64
        // (§ Transaction.preuveUrl). La demander ici ferait passer plusieurs
        // mégaoctets par ouverture de l'écran de comptabilité, pour une liste
        // qui n'affiche qu'une icône.
        omit: { preuveUrl: true },
        include: INCLUDE_LIGNE_JOURNAL,
      }),
      // Savoir QU'UN justificatif existe ne demande pas de le lire : cette
      // requête ne ramène que des identifiants, et Postgres n'a pas à sortir
      // la valeur de son stockage TOAST pour répondre au `IS NOT NULL`.
      prisma.transaction.findMany({
        where: { ...where, preuveUrl: { not: null } },
        select: { id: true },
      }),
      // Les écritures annulées restent comptées : leur transaction de
      // compensation (montant/type inversés) neutralise déjà leur effet dans
      // la somme. Les écritures SUPPRIMÉES, elles, sortent des totaux — et
      // une écriture annulée n'est jamais supprimée sans sa compensation
      // (lib/journal-comptable.ts), la neutralisation reste donc juste.
      prisma.transaction.groupBy({ by: ['type'], where: { supprimeLe: null }, _sum: { montant: true } }),
    ]);

    const totalEntrees = Number(totaux.find((t) => t.type === 'revenu')?._sum.montant ?? 0);
    const totalSorties = Number(totaux.find((t) => t.type === 'depense')?._sum.montant ?? 0);

    const avecPreuve = new Set(idsAvecPreuve.map((t) => t.id));

    return NextResponse.json(
      {
        // Un POINTEUR vers la route de contenu, jamais l'octet — même
        // convention que les pièces jointes de tâche (§ PieceJointeExposee.url).
        // `null` quand l'écriture n'a pas de justificatif : le tableau n'a
        // alors rien à proposer d'ouvrir.
        data: transactions.map((t) => exposerLigne(t, avecPreuve.has(t.id) ? cheminPreuve(t.id) : null)),
        totaux: {
          totalEntrees,
          totalSorties,
          solde: totalEntrees - totalSorties,
        },
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

    const titre = analyserTitre(body.titre);
    if (titre.statut === 'refus') throw new ApiError(400, titre.message);
    const montant = analyserMontant(body.montant);
    if (montant.statut === 'refus') throw new ApiError(400, montant.message);
    if (!estTypeTransaction(body.type)) throw new ApiError(400, 'Type de transaction invalide');
    const type = body.type;
    const dateEffet = analyserDate(body.dateEffet, "Date d'effet");
    if (dateEffet.statut === 'refus') throw new ApiError(400, dateEffet.message);
    const description = texteFacultatif(body.description);
    if (typeof body.categorieId !== 'string' || !body.categorieId) throw new ApiError(400, 'La catégorie est requise');
    // Existe ET appartient aux transactions : l'identifiant d'une catégorie de
    // commande d'inventaire passerait la clé étrangère sans broncher.
    const categorie = await verifierCategorie(prisma, body.categorieId, 'transaction');

    // Justificatif photo FACULTATIF (§ Transaction.preuveUrl) : une écriture
    // sans preuve est valide et complète. Mais une preuve fournie est validée
    // avant d'entrer en base — format et poids — et c'est la forme normalisée
    // qui est stockée, pas la saisie : la relecture n'a plus rien à rattraper.
    const preuveBrute = typeof body.preuveUrl === 'string' ? body.preuveUrl.trim() : '';
    let preuveUrl: string | null = null;
    if (preuveBrute) {
      const analyse = analyserPreuveComptable(preuveBrute);
      if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
      preuveUrl = dataUrlPreuve(analyse.preuve);
    }

    const transaction = await prisma.transaction.create({
      data: {
        titre: titre.valeur,
        montant: montant.valeur,
        type,
        categorieId: categorie.id,
        dateEffet: dateEffet.valeur,
        description,
        preuveUrl,
        auteurId: session.sub,
      },
      // La photo ne repart pas dans la réponse qui vient de l'écrire : le
      // client l'a déjà, et le journal ne travaille que sur le pointeur.
      omit: { preuveUrl: true },
      include: INCLUDE_LIGNE_JOURNAL,
    });

    return NextResponse.json(exposerLigne(transaction, preuveUrl ? cheminPreuve(transaction.id) : null), {
      status: 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}
