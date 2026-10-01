import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { remettreBonEnvoiPower } from '@/lib/remise-power-delivery';
import { destinatairesBackoffice, notifier } from '@/lib/notifications';

// § Power Delivery — remet par leur API les colis d'un bon d'envoi vers une
// de leurs agences (lib/remise-power-delivery.ts). Toujours 200 quand le bon
// a pu être traité, même si des colis sont refusés : chaque colis porte son
// issue, et un 4xx global dirait « rien n'a été fait » alors que d'autres
// colis sont peut-être partis.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    const resultat = await remettreBonEnvoiPower(id, session.sub);

    // § Notifications : des colis restés chez nous alors que le bon est parti
    // — à reprendre par quelqu'un. Celui qui a lancé la remise lit déjà le
    // détail à l'écran ; ce sont les AUTRES responsables des bons d'envoi
    // qu'il faut prévenir, le jour où il n'est pas là pour s'en occuper.
    if (resultat.totalNonRemis > 0) {
      await notifier(await destinatairesBackoffice('bon_envoi:manage'), {
        type: 'transporteur.erreur',
        titre: `Power Delivery : ${resultat.totalNonRemis} colis non remis`,
        corps: `Bon d'envoi ${resultat.numero}`,
        lien: `/admin/bon-envoi/${resultat.bonEnvoiId}`,
      }, { sauf: session.sub });
    }

    return NextResponse.json(resultat);
  } catch (error) {
    return jsonError(error);
  }
}
