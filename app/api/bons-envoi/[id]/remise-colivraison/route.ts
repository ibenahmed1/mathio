import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { remettreBonEnvoiColivraison } from '@/lib/remise-colivraison';
import { destinatairesBackoffice, notifier } from '@/lib/notifications';

// § Colivraison — remet par leur API les colis d'un bon d'envoi qui leur est
// destiné (lib/remise-colivraison.ts). Toujours 200 quand le bon a pu être
// traité, même si des colis sont refusés : chaque colis porte son issue.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    const resultat = await remettreBonEnvoiColivraison(id, session.sub);

    // § Notifications : des colis restés chez nous, à reprendre par un autre
    // responsable des bons d'envoi (cf. la remise Power Delivery).
    if (resultat.totalNonRemis > 0) {
      await notifier(await destinatairesBackoffice('bon_envoi:manage'), {
        type: 'transporteur.erreur',
        titre: `Colivraison : ${resultat.totalNonRemis} colis non remis`,
        corps: `Bon d'envoi ${resultat.numero}`,
        lien: `/admin/bon-envoi/${resultat.bonEnvoiId}`,
      }, { sauf: session.sub });
    }

    return NextResponse.json(resultat);
  } catch (error) {
    return jsonError(error);
  }
}
