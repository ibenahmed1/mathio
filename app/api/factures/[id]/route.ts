import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import {
  ecrireSelection,
  getColisFacturables,
  getFacture,
  getFacturePourMarchand,
  getTarifsMarchand,
  parseFraisAnnexes,
} from '@/lib/facturation';
import { getCoutsPrestataire } from '@/lib/prestataires';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// Détail complet d'une facture, lignes et frais annexes compris — c'est cette
// réponse qui alimente la vue d'impression partagée (/factures/[id]) et
// l'écran de reprise d'un brouillon. Les montants affichés sont ceux figés à
// l'émission, jamais recalculés.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_FACTURATION, 'marchand']);
    const { id } = await params;

    // Le marchand reçoit la version sans nos coûts (cf.
    // getFacturePourMarchand) : sa facture dit ce qu'il nous doit, pas ce que
    // la course nous a coûté.
    const facture = session.role === 'marchand' ? await getFacturePourMarchand(id) : await getFacture(id);

    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      // 404 et non 403 : un marchand n'a pas à apprendre qu'une facture
      // existe chez un autre, même par la négative. Un brouillon lui est
      // invisible pour la même raison qu'il n'apparaît pas dans sa liste —
      // il n'a pas encore été arrêté.
      if (!marchand || marchand.id !== facture.marchandId || facture.statut === 'brouillon') {
        throw new ApiError(404, 'Facture introuvable');
      }
    }

    return NextResponse.json(facture);
  } catch (error) {
    return jsonError(error);
  }
}

// Modifie un BROUILLON : sélection de colis et/ou frais annexes. C'est ce qui
// donne son sens au brouillon — un document qu'on ne peut pas rouvrir n'est
// pas un brouillon, c'est une facture émise avec une étiquette différente.
//
// Les deux champs sont indépendamment optionnels : l'écran d'édition renvoie
// toujours les deux, mais une correction ciblée (ajouter un frais oublié) ne
// doit pas obliger à retransmettre trois cents identifiants de colis.
//
// Toute la sélection est réécrite plutôt que patchée en delta (cf.
// ecrireSelection) : les colis retirés sont rendus facturables dans la même
// transaction que ceux qui entrent, et les totaux sont recalculés depuis les
// lignes réellement en base.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_FACTURATION]);
    const { id } = await params;
    const body = await request.json();

    const facture = await prisma.facture.findUnique({
      where: { id },
      select: {
        id: true,
        statut: true,
        marchandId: true,
        lignes: { select: { commandeId: true } },
        fraisAnnexes: { select: { libelle: true, montant: true } },
      },
    });
    if (!facture) throw new ApiError(404, 'Facture introuvable');
    if (facture.statut !== 'brouillon') {
      throw new ApiError(
        409,
        `Une facture ${facture.statut} ne se modifie plus. Seul un brouillon est modifiable.`
      );
    }

    const autresFrais =
      body.autresFrais === undefined
        ? facture.fraisAnnexes.map((f) => ({ libelle: f.libelle, montant: Number(f.montant) }))
        : parseFraisAnnexes(body.autresFrais);

    const colisIds =
      body.colisIds === undefined
        ? facture.lignes.map((l) => l.commandeId)
        : parseStringIdArray(body.colisIds);

    if (colisIds.length === 0) {
      throw new ApiError(409, 'Une facture doit porter au moins un colis');
    }

    const marchand = await prisma.marchand.findUniqueOrThrow({
      where: { id: facture.marchandId },
      select: { id: true, fraisLivraison: true, fraisRetour: true },
    });

    // L'assiette inclut les colis DÉJÀ pris par cette facture : sans ça, un
    // colis retiré puis remis à l'écran serait refusé comme « plus
    // facturable » alors que c'est cette facture elle-même qui le retient.
    const disponibles = await getColisFacturables(facture.marchandId, id);
    const retenus = disponibles.filter((c) => colisIds.includes(c.id));

    if (retenus.length !== colisIds.length) {
      throw new ApiError(
        409,
        'Un ou plusieurs colis sélectionnés ne sont plus facturables (déjà pris dans une autre facture, ou état de paiement modifié entre-temps)'
      );
    }

    const [tarifs, couts] = await Promise.all([getTarifsMarchand(marchand), getCoutsPrestataire()]);

    await prisma.$transaction((tx) =>
      ecrireSelection(tx, {
        factureId: id,
        colis: retenus,
        tarifs,
        couts,
        autresFrais,
        auteurId: session.sub,
      })
    );

    return NextResponse.json(await getFacture(id));
  } catch (error) {
    return jsonError(error);
  }
}
