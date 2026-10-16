import { NextResponse } from 'next/server';
import { ApiError, jsonError, parseStringIdArray, requirePermission } from '@/lib/api-utils';
import { creerBonEnvoiExceptionnel } from '@/lib/bon-envoi-exceptionnel';
import { remettreBonEnvoiPower, type ResultatRemiseBon } from '@/lib/remise-power-delivery';
import { destinatairesBackoffice, notifier } from '@/lib/notifications';

// § Bon d'envoi exceptionnel (lib/bon-envoi-exceptionnel.ts). Ouvert à tout
// compte qui compose les bons d'envoi (`bon_envoi:create`). Pour Power
// Delivery seulement, les colis leur sont remis par API dans la foulée : le
// bon est créé quoi qu'il arrive, et chaque colis porte son issue.
export async function POST(request: Request) {
  try {
    const session = await requirePermission('bon_envoi:create');
    const body = await request.json();

    const prestataireId = typeof body.prestataireId === 'string' ? body.prestataireId.trim() : '';
    if (!prestataireId) throw new ApiError(400, 'Choisissez le transporteur');
    const motif = typeof body.motif === 'string' ? body.motif : '';
    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) throw new ApiError(400, 'Scannez au moins un colis');

    const bon = await creerBonEnvoiExceptionnel({ prestataireId, colisIds, motif, auteurId: session.sub });

    let remisePower: ResultatRemiseBon | null = null;
    let erreurPower: string | null = null;
    if (bon.power) {
      try {
        remisePower = await remettreBonEnvoiPower(bon.id, session.sub);
      } catch (erreur) {
        // Le bon existe : la remise se relance depuis sa fiche.
        erreurPower = erreur instanceof Error ? erreur.message : 'Remise Power impossible';
      }
    }

    await notifier(await destinatairesBackoffice('bon_envoi:manage'), {
      type: 'bon_envoi.cree',
      titre: `BE exceptionnel ${bon.numero}`,
      corps: `${bon.nbColis} colis — motif : ${motif.trim()}`,
      lien: `/admin/bon-envoi/${bon.id}`,
    }, { sauf: session.sub });

    return NextResponse.json({ ...bon, remisePower, erreurPower }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
