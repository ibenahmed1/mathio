import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { roleMatches } from '@/lib/auth';
import { validateQrPayload } from '@/lib/parcel-serial';
import { ROLES_DEROGATION_REINTEGRATION, resolveBonDistributionAutorise } from '@/lib/bon-distribution';

// § Clôture de tournée : le Planner scanne un par un les colis non livrés que
// le livreur ramène au dépôt. Le scan fait basculer le colis de son état
// TERRAIN (refuse / reporte / annule / mise_en_distribution s'il n'a même pas
// été tenté) vers son état PHYSIQUE au dépôt : retourne_au_hub. Le motif
// terrain n'est pas écrasé (Commande.motifRetour est conservé) et reste
// lisible dans l'historique — le scan ne dit que "ce colis est de nouveau au
// hub X", il ne réinterprète pas la tentative de livraison.
//
// Matrice d'autorisation du scan, trois cas et trois seulement :
//   • statut "livre"                -> REFUSÉ pour tout le monde, sans exception.
//   • statut "mise_en_distribution" -> DÉROGATION réservée au Planner et à
//     l'Admin (cf. ROLES_DEROGATION_REINTEGRATION), tracée comme telle.
//   • tout autre statut (refuse, reporte, annule, injoignable...) -> AUTORISÉ,
//     c'est le retour de tournée nominal.
//
// Idempotent : rescanner un colis déjà rentré renvoie 200 sans recréer
// d'entrée d'historique (même convention que POST /api/commandes/scan-reception).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;
    const body = await request.json();

    const bon = await resolveBonDistributionAutorise(session, id);
    if (bon.statut === 'cloture') {
      throw new ApiError(409, 'Cette tournée est déjà clôturée : plus aucun retour ne peut y être enregistré');
    }

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

    const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
    if (!commande) {
      throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    }
    // Un colis ne peut rentrer que dans la tournée qui l'a emporté : scanner
    // au retour un colis d'une autre tournée fausserait les deux décomptes.
    if (commande.bonDistributionId !== bon.id) {
      throw new ApiError(409, `Ce colis n'appartient pas à la tournée ${bon.numero}.`);
    }
    if (commande.statut === 'retourne_au_hub') {
      return NextResponse.json({ commande, dejaScanne: true, parDerogation: false });
    }
    // Frontière dure : un colis livré a été remis au client et son CRBT est
    // déjà compté dans la caisse de la tournée. Aucun rôle, aucune dérogation
    // ne le fait revenir au dépôt par un scan — s'il est physiquement là,
    // c'est que la livraison était une erreur de saisie, et cela se corrige
    // par le back-office (PATCH /api/commandes/[id]/statut), pas ici.
    if (commande.statut === 'livre') {
      throw new ApiError(
        409,
        `Ce colis est au statut "Livré" : un colis remis au client ne peut jamais être scanné en retour au Hub.`
      );
    }
    // Dérogation opérationnelle : le colis est encore "Mise en distribution",
    // c'est-à-dire que le livreur ne l'a jamais qualifié sur son application
    // (oubli, panne, batterie vide) alors qu'il est physiquement de retour au
    // quai. Le scanner revient à trancher à sa place : réservé au Planner et à
    // l'Admin, et tracé comme tel dans l'historique.
    const parDerogation = commande.statut === 'mise_en_distribution';
    if (parDerogation && !roleMatches(session, ROLES_DEROGATION_REINTEGRATION)) {
      throw new ApiError(
        403,
        `Ce colis n'a pas été qualifié par le livreur (statut "Mise en distribution") : seuls le Planner et l'Admin peuvent forcer sa réintégration au dépôt.`
      );
    }

    const planner = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { nomComplet: true },
    });
    const auteur = planner?.nomComplet ?? 'Planificateur';
    const motifTerrain = commande.motifRetour ? ` (motif terrain : ${commande.motifRetour})` : '';

    // RG-10 : l'historique porte le hub, l'auteur du scan et l'état terrain
    // d'origine. La réintégration par dérogation est libellée distinctement —
    // c'est ce qui permet, plus tard, de distinguer un retour qualifié sur le
    // terrain d'un retour forcé au dépôt faute de qualification.
    // `hub.ville` et non `hub.nom` : les hubs sont nommés "Hub Casablanca" en
    // base, un "Hub ${nom}" écrirait « Hub Hub Casablanca » dans l'historique.
    const note = parDerogation
      ? `Réintégration directe par dérogation Planner/Admin — colis non qualifié par le livreur (statut "Mise en distribution"), rentré au Hub ${bon.hub.ville} et scanné par ${auteur} à la clôture de la tournée ${bon.numero}`
      : `Retour de tournée ${bon.numero} scanné au Hub ${bon.hub.ville} par ${auteur}${motifTerrain}`;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id: commande.id },
        data: {
          statut: 'retourne_au_hub',
          hubActuelId: bon.hubId,
          dateReceptionHub: new Date(),
        },
        // Porte la ville du hub pour que l'appelant puisse afficher le statut
        // sous sa forme complète, « Retourné au Hub (Casablanca) ».
        include: { hubActuel: { select: { ville: true } } },
      });

      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: commande.id,
          ancienStatut: commande.statut,
          nouveauStatut: 'retourne_au_hub',
          utilisateurId: session.sub,
          hubId: bon.hubId,
          note,
        },
      });

      return result;
    });

    return NextResponse.json({ commande: updated, dejaScanne: false, parDerogation });
  } catch (error) {
    return jsonError(error);
  }
}
