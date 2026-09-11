import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import {
  creerFacture,
  FACTURE_OMIT_COUTS,
  getColisFacturables,
  getTarifsMarchand,
  parseFraisAnnexes,
  parseReglement,
  reglerFacture,
} from '@/lib/facturation';
import { getCoutsPrestataire } from '@/lib/prestataires';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutFacture } from '@/app/generated/prisma/enums';

// § Facturation marchand (/admin/factures).
//
// Émission réservée à admin + responsable, comme la comptabilité (cf.
// ROLES_COMPTABILITE dans app/api/finance/route.ts) : une facture est une
// écriture financière engageante, pas un document d'exploitation.
const ROLES_FACTURATION = ['admin', 'responsable'] as const;

const STATUTS_FACTURE: StatutFacture[] = ['brouillon', 'emise', 'payee', 'annulee'];

// Ce que le marchand a le droit de voir. Un BROUILLON n'a rien à y faire : il
// n'a pas encore été arrêté, ses montants peuvent bouger d'ici l'émission, et
// l'annoncer reviendrait à promettre un chiffre qu'on n'a pas encore décidé.
const STATUTS_VISIBLES_MARCHAND: StatutFacture[] = ['emise', 'payee', 'annulee'];

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_FACTURATION, 'marchand']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const where: Prisma.FactureWhereInput = {};

    // Cloisonnement marchand : il ne voit que SES factures, et le périmètre
    // est résolu côté serveur — jamais depuis un marchandId envoyé par le
    // client (cf. resolveMarchandForUser, qui couvre aussi les membres
    // d'équipe invités).
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Aucune boutique rattachée à ce compte');
      where.marchandId = marchand.id;
      where.statut = { in: STATUTS_VISIBLES_MARCHAND };
    } else {
      const marchandId = searchParams.get('marchandId');
      if (marchandId) where.marchandId = marchandId;
    }

    const statut = searchParams.get('statut');
    if (statut) {
      if (!STATUTS_FACTURE.includes(statut as StatutFacture)) {
        throw new ApiError(400, 'Statut de facture invalide');
      }
      // Un marchand qui demanderait `brouillon` ne doit pas contourner le
      // filtre ci-dessus : l'intersection reste vide plutôt que de s'élargir.
      where.statut =
        session.role === 'marchand'
          ? { in: STATUTS_VISIBLES_MARCHAND.filter((s) => s === statut) }
          : (statut as StatutFacture);
    }

    const [data, total] = await Promise.all([
      prisma.facture.findMany({
        where,
        // Les totaux de coût ne descendent jamais dans une liste servie à un
        // marchand — même règle que le détail (cf. getFacturePourMarchand).
        ...(session.role === 'marchand' ? { omit: FACTURE_OMIT_COUTS } : {}),
        include: {
          marchand: { select: { id: true, nomBoutique: true, raisonSociale: true } },
          emisePar: { select: { nomComplet: true } },
        },
        orderBy: { dateEmission: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.facture.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// Crée une facture pour un marchand. Comme pour le Bon d'Envoi, la sélection
// envoyée par le client est REVALIDÉE contre l'éligibilité réelle : entre le
// chargement de l'écran et le clic, un colis a pu être facturé par quelqu'un
// d'autre ou changer d'état de paiement.
//
// `colisIds` est optionnel : sans lui, on facture tout ce qui est facturable
// (le cas courant, « facturer la période »).
//
// `finaliser` dit jusqu'où pousser le document dans son cycle :
//   brouillon (défaut) — enregistré, colis réservés, tout reste modifiable ;
//   emise             — montants figés, visible du marchand ;
//   payee             — figée ET réglée dans la même transaction, avec son
//                       écriture comptable. Le raccourci n'existe qu'ICI, à la
//                       création : c'est le seul moment où l'utilisateur a
//                       sous les yeux le détail de ce qu'il paie. Passé cet
//                       instant, il faut émettre puis payer en deux gestes
//                       (cf. POST /api/factures/[id]/payer), pour la même
//                       raison que côté livreur — on ne décaisse pas un
//                       montant encore modifiable.
const FINALISATIONS = ['brouillon', 'emise', 'payee'] as const;
type Finalisation = (typeof FINALISATIONS)[number];

export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_FACTURATION]);
    const body = await request.json();

    const marchandId = typeof body.marchandId === 'string' ? body.marchandId.trim() : '';
    if (!marchandId) throw new ApiError(400, 'marchandId est requis');

    const finaliser: Finalisation = FINALISATIONS.includes(body.finaliser)
      ? body.finaliser
      : 'brouillon';

    // Le mode de règlement est validé AVANT d'ouvrir la transaction : échouer
    // après avoir créé le numéro de facture consommerait une séquence pour
    // rien.
    const reglement = finaliser === 'payee' ? parseReglement(body) : null;

    const marchand = await prisma.marchand.findUnique({
      where: { id: marchandId },
      select: { id: true, nomBoutique: true, fraisLivraison: true, fraisRetour: true },
    });
    if (!marchand) throw new ApiError(404, 'Marchand introuvable');

    const autresFrais = parseFraisAnnexes(body.autresFrais);

    const colisIds = parseStringIdArray(body.colisIds);
    const facturables = await getColisFacturables(marchandId);
    const retenus = colisIds.length > 0 ? facturables.filter((c) => colisIds.includes(c.id)) : facturables;

    if (retenus.length === 0) {
      throw new ApiError(409, 'Aucun colis facturable dans cette sélection');
    }
    if (colisIds.length > 0 && retenus.length !== colisIds.length) {
      throw new ApiError(
        409,
        'Un ou plusieurs colis sélectionnés ne sont plus facturables (déjà pris dans une autre facture, ou état de paiement modifié entre-temps)'
      );
    }

    const [tarifs, couts] = await Promise.all([getTarifsMarchand(marchand), getCoutsPrestataire()]);
    const now = new Date();

    const facture = await prisma.$transaction(async (tx) => {
      const creee = await creerFacture(tx, {
        marchandId,
        colis: retenus,
        tarifs,
        couts,
        autresFrais,
        emiseParId: session.sub,
      });

      if (finaliser === 'brouillon') return creee;

      const emise = await tx.facture.update({
        where: { id: creee.id },
        data: { statut: 'emise', dateValidation: now, valideParId: session.sub },
      });

      if (finaliser === 'emise') return emise;

      return reglerFacture(tx, {
        factureId: creee.id,
        auteurId: session.sub,
        modeReglement: reglement!.modeReglement,
        referenceReglement: reglement!.referenceReglement,
        date: now,
      });
    });

    return NextResponse.json(facture, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
