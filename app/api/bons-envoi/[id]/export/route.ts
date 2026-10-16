import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { classeurColis, includeColisExcel, reponseExcel } from '@/lib/export-colis-excel';

// Export Excel d'un Bon d'Envoi : le fichier transmis au transporteur (étape 1
// du bandeau de transmission), au format du 14/10/2026 (lib/export-colis-excel.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonEnvoi.findUnique({
      where: { id },
      select: { numero: true, commandes: { include: includeColisExcel, orderBy: { codeSuivi: 'asc' } } },
    });
    if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");

    return reponseExcel(classeurColis(bon.commandes), `${bon.numero}.xlsx`);
  } catch (error) {
    return jsonError(error);
  }
}
