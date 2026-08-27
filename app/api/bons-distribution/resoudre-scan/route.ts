import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { resolveUserHub } from '@/lib/hub-envoi';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';

// § /admin/scan/tournee — résolution d'un code scanné, SANS AUCUNE MUTATION.
//
// Le Planner fait deux gestes de scan au quai, et un seul code-barres : lui
// demander de choisir le bon mode avant de scanner revient à lui faire
// deviner l'état du colis qu'il tient en main. Il tranchait forcément mal de
// temps en temps, et l'erreur reçue ("seul un colis ramasse ou en_transit
// peut être réceptionné au hub") ne renvoyait pas vers l'autre geste.
//
// Cet endpoint dit simplement ce que le colis appelle, à partir de son état
// réel. Les deux cas sont disjoints par construction — un colis ne peut pas
// être à la fois en attente de réception au quai et sorti en tournée — donc
// la résolution est déterministe, jamais une devinette :
//   • "ramasse" / "en_transit"            -> reception  (POST /api/commandes/scan-reception)
//   • rattaché à une tournée OUVERTE de son hub, non livré
//                                          -> retour     (POST /api/bons-distribution/[id]/scan-retour)
//   • tout le reste                        -> aucune, avec le motif exact
//
// L'action elle-même reste faite par les deux routes existantes : rien de la
// règle métier (statuts autorisés, dérogation, idempotence, historisation)
// n'est réimplémenté ici.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const body = await request.json();

    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
    let codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim().toUpperCase() : '';

    if (qrPayload) {
      const result = validateQrPayload(qrPayload);
      if (!result.valid || result.parcelId === undefined) {
        throw new ApiError(400, result.reason ?? 'QR code invalide');
      }
      codeSuivi = `PD-${String(result.parcelId).padStart(6, '0')}`;
    }

    if (!codeSuivi) {
      throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
    }

    const commande = await prisma.commande.findUnique({
      where: { codeSuivi },
      select: {
        id: true,
        codeSuivi: true,
        clientNom: true,
        ville: true,
        statut: true,
        bonDistribution: {
          // `ville` et non `nom` pour les messages : les hubs sont nommés
          // "Hub Casablanca" en base, donc un "Hub ${nom}" rendrait
          // « Hub Hub Casablanca ». C'est aussi la donnée que porte le libellé
          // du statut, « Retourné au Hub (Casablanca) ».
          select: { id: true, numero: true, statut: true, hubId: true, hub: { select: { nom: true, ville: true } } },
        },
      },
    });
    if (!commande) {
      throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    }

    // Périmètre : un planner ne pilote que son hub. On le résout ici pour ne
    // jamais proposer un retour que le scan refusera ensuite en 403.
    const hubPlanner = session.role === 'planner' ? await resolveUserHub(session.sub) : null;
    const bon = commande.bonDistribution;
    const libelleStatut = LABELS_STATUT_COMMANDE[commande.statut] ?? commande.statut;

    if (commande.statut === 'ramasse' || commande.statut === 'en_transit') {
      return NextResponse.json({ commande, action: 'reception' as const, bon: null });
    }

    if (bon && bon.statut !== 'cloture') {
      if (hubPlanner && bon.hubId !== hubPlanner.id) {
        return NextResponse.json({
          commande,
          action: 'aucune' as const,
          bon,
          raison: `La tournée ${bon.numero} relève du Hub ${bon.hub.ville}, hors de votre périmètre.`,
        });
      }
      if (commande.statut === 'livre') {
        return NextResponse.json({
          commande,
          action: 'aucune' as const,
          bon,
          raison: `Ce colis est livré : un colis remis au client ne revient jamais au dépôt.`,
        });
      }
      return NextResponse.json({ commande, action: 'retour' as const, bon });
    }

    return NextResponse.json({
      commande,
      action: 'aucune' as const,
      bon,
      raison: bon
        ? `La tournée ${bon.numero} est déjà clôturée : ce colis (${libelleStatut}) n'y est plus modifiable.`
        : `Ce colis est au statut "${libelleStatut}" et n'est rattaché à aucune tournée ouverte : ni réception au quai, ni retour de tournée ne s'appliquent.`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
