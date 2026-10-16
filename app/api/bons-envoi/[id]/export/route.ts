import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { classeurColis, includeColisExcel, reponseExcel } from '@/lib/export-colis-excel';
import { partiParApi } from '@/lib/remise-affichage';

// Export Excel d'un Bon d'Envoi : le fichier transmis au transporteur (étape 1
// du bandeau de transmission), au format du 14/10/2026 (lib/export-colis-excel.ts).
//
// `?restants=1` : seulement les colis que l'API du transporteur n'a pas pris
// (16/10/2026). Un colis accepté — ou à confirmer — par l'API n'y figure pas :
// transmis aussi par l'Excel, il serait créé deux fois chez eux.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      select: {
        numero: true,
        commandes: {
          include: { ...includeColisExcel, remisesPrestataire: { where: { bonEnvoiId: id }, orderBy: { creeLe: 'desc' }, select: { etat: true, active: true, codeEnvoye: true, codeExterne: true, erreur: true } } },
          orderBy: { codeSuivi: 'asc' },
        },
      },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    if (new URL(request.url).searchParams.get('restants') === '1') {
      const restants = bon.commandes.filter((c) => !partiParApi(c.remisesPrestataire));
      if (restants.length === 0) throw new ApiError(409, 'Tous les colis de ce bon sont partis par API : rien à transmettre par Excel');
      return reponseExcel(classeurColis(restants), `${bon.numero}-restants.xlsx`);
    }
    return reponseExcel(classeurColis(bon.commandes), `${bon.numero}.xlsx`);
  } catch (error) {
    return jsonError(error);
  }
}
