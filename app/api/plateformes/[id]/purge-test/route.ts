import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { purgerDonneesTest } from '@/lib/plateformes';

// Purge des données de bac à sable d'une plateforme.
//
// POST et non DELETE : la ressource visée n'est pas la plateforme mais un
// ENSEMBLE de lignes réparties sur cinq tables, et l'appel renvoie un compte
// rendu de ce qui a été supprimé. `DELETE /api/plateformes/[id]` voudrait dire
// « supprimer la plateforme », ce qui n'est pas ce qui se passe ici.
//
// Ne touche jamais à `live`, ni aux marchands que la plateforme n'a pas créés
// (cf. CompteMarchandExterne.creeParSynchro) : un marchand rattaché s'était
// inscrit en direct chez nous, il ne disparaît pas avec un jeu d'essai.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id } = await params;

    const volume = await purgerDonneesTest(id);

    // Suppression en masse et irréversible : elle laisse une trace, au même
    // titre que l'émission ou la révocation d'une clé.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'plateforme.purge_test',
        cibleType: 'plateforme',
        cibleId: id,
        adresseIp: getClientIp(request),
      },
    });

    return NextResponse.json(volume);
  } catch (error) {
    return jsonError(error);
  }
}
