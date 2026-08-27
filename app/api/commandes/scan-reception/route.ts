import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { resolveUserHub } from '@/lib/hub-envoi';

// § /admin/scan/reception : l'Agent Hub scanne le codeSuivi d'un colis déposé
// au quai de son hub (Utilisateur.hubId). Seul un colis au
// statut "ramasse" peut être réceptionné ici — il bascule alors à
// "recu_au_hub". C'est le SEUL chemin qui fait cette transition pour un rôle
// non-admin (même principe que POST /api/commandes/scan pour "ramasse", cf.
// RG-13 dans ce fichier).
// Idempotent : un scan rejoué sur un colis déjà "recu_au_hub" ne réechoue pas
// et ne recrée pas d'entrée d'historique.
export async function POST(request: Request) {
  try {
    // § /admin/scan/tournee : le Planner scanne lui aussi au quai de son hub. C'est
    // le même geste que l'Agent Hub (et la même transition), avec le même
    // cantonnement — son hub de rattachement, jamais celui du body — mais
    // depuis sa propre web app : sans ça, il ne pourrait pas alimenter le
    // stock de colis "recu_au_hub" qu'il doit ensuite répartir en tournées.
    const session = await requireUser(['agent_hub', 'planner', 'admin']);
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

    // Résolution du hub de réception : pour un agent_hub comme pour un
    // planner, c'est toujours son propre hub de rattachement (obligatoire,
    // jamais celui fourni dans le body — évite de réceptionner "au nom" d'un
    // autre hub). Pour l'admin (dépannage/tests), le hub doit être fourni
    // explicitement.
    let hub: { id: string; nom: string; ville: string } | null = null;
    if (session.role === 'agent_hub' || session.role === 'planner') {
      hub = await resolveUserHub(session.sub);
    } else {
      const hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';
      if (!hubId) {
        throw new ApiError(400, 'hubId est requis pour réceptionner un colis en tant qu\'administrateur');
      }
      const found = await prisma.hub.findUnique({ where: { id: hubId }, select: { id: true, nom: true, ville: true } });
      if (!found) {
        throw new ApiError(400, 'Hub introuvable');
      }
      hub = found;
    }

    const commande = await prisma.commande.findUnique({
      where: { codeSuivi },
      include: {
        ramasseur: { select: { id: true, nomComplet: true } },
        hubActuel: { select: { id: true, nom: true, ville: true } },
      },
    });
    if (!commande) {
      throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    }

    // Rejeu idempotent : déjà réceptionné, on ne refait rien.
    if (commande.statut === 'recu_au_hub') {
      return NextResponse.json(commande);
    }
    // Le passage à "recu_au_hub" est autorisé depuis DEUX statuts d'origine,
    // selon que le colis arrive au hub pour la première fois ou après un
    // transit inter-hubs :
    //   - "ramasse" -> "recu_au_hub" (ex. Agent Hub Casa réceptionnant un
    //     colis tout juste collecté chez le marchand) ;
    //   - "en_transit" -> "recu_au_hub" (ex. Agent Hub Tanger réceptionnant
    //     individuellement un colis arrivé via un Bon d'Envoi, sans attendre
    //     la clôture groupée de POST /api/bons-envoi/[id]/marquer-recu).
    if (commande.statut !== 'ramasse' && commande.statut !== 'en_transit') {
      throw new ApiError(
        409,
        `Ce colis est au statut "${commande.statut}" : seul un colis "ramasse" ou "en_transit" peut être réceptionné au hub`
      );
    }

    const now = new Date();
    const utilisateur = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { nomComplet: true },
    });
    const note = `Reçu au ${hub.nom} par ${utilisateur?.nomComplet ?? session.sub}`;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id: commande.id },
        data: {
          statut: 'recu_au_hub',
          hubActuelId: hub!.id,
          dateReceptionHub: now,
        },
        include: {
          ramasseur: { select: { id: true, nomComplet: true } },
          hubActuel: { select: { id: true, nom: true, ville: true } },
        },
      });

      // RG-10 / RNF-11 : historisation avec auteur, hub et message explicite
      // — permet de retrouver "qui a réceptionné quel colis, à quel hub".
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: commande.id,
          ancienStatut: commande.statut,
          nouveauStatut: 'recu_au_hub',
          utilisateurId: session.sub,
          hubId: hub!.id,
          note,
        },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

// § /admin/scan/reception : dès le premier scan d'un colis "ramasse", le
// front recharge automatiquement le reste de la tournée du même ramasseur
// (RG "détection auto par le premier scan"). Nécessite un endpoint dédié —
// GET /api/commandes force hubActuelId=hub de l'agent pour le rôle
// agent_hub (cloisonnement RG-07), ce qui exclurait justement les colis
// "ramasse" pas encore reçus (hubActuelId encore null).
export async function GET(request: Request) {
  try {
    await requireUser(['agent_hub', 'admin']);
    const { searchParams } = new URL(request.url);
    const ramasseurId = searchParams.get('ramasseurId')?.trim();
    if (!ramasseurId) {
      throw new ApiError(400, 'ramasseurId est requis');
    }

    const data = await prisma.commande.findMany({
      where: { statut: 'ramasse', ramasseurId },
      include: { ramasseur: { select: { id: true, nomComplet: true } } },
      orderBy: { dateCollecte: 'asc' },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
