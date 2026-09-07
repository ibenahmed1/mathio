import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { FENETRE_DEPRECIATION_MS } from '@/lib/plateforme-cles';
import { programmerExpiration, revoquerCleApi } from '@/lib/plateformes';

// Les deux faces d'une fin de vie de clé, et elles ne se confondent pas :
//
//   action: "revoquer"  → refus DUR, immédiat. Pour une clé compromise.
//   action: "expirer"   → refus DOUX à l'échéance, précédé d'un en-tête de
//                         dépréciation sur chaque appel de la fenêtre de
//                         grâce. C'est la moitié « ancienne clé » d'une
//                         rotation, et ça laisse au partenaire le temps de
//                         déployer la nouvelle.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; cleId: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id, cleId } = await params;
    const body = await request.json();

    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'revoquer') {
      const cle = await revoquerCleApi(id, cleId);
      await prisma.auditLog.create({
        data: {
          adminId: session.sub,
          action: 'cle_api.revocation',
          cibleType: 'plateforme',
          cibleId: id,
          adresseIp: getClientIp(request),
        },
      });
      return NextResponse.json(cle);
    }

    if (action === 'expirer') {
      // Échéance par défaut : la fenêtre de grâce entière. C'est le cas
      // courant d'une rotation, et le seul pour lequel l'en-tête de
      // dépréciation a le temps d'être vu dans les journaux du partenaire.
      let expireLe = new Date(Date.now() + FENETRE_DEPRECIATION_MS);
      if (body.expireLe !== undefined) {
        const fournie = new Date(String(body.expireLe));
        if (Number.isNaN(fournie.getTime())) {
          throw new ApiError(400, 'expireLe doit être une date ISO 8601');
        }
        // Une échéance passée produirait une clé morte mais NON révoquée : elle
        // refuserait tout, sans que l'écran ni le journal ne disent pourquoi, et
        // sans que le partenaire ait vu passer le moindre en-tête de
        // dépréciation. Couper une clé sur-le-champ a déjà son geste, et il
        // s'appelle « révoquer ».
        if (fournie <= new Date()) {
          throw new ApiError(
            400,
            'expireLe doit être dans le futur. Pour couper une clé immédiatement, utiliser action « revoquer »'
          );
        }
        expireLe = fournie;
      }

      const cle = await programmerExpiration(id, cleId, expireLe);
      await prisma.auditLog.create({
        data: {
          adminId: session.sub,
          action: 'cle_api.rotation',
          cibleType: 'plateforme',
          cibleId: id,
          adresseIp: getClientIp(request),
        },
      });
      return NextResponse.json(cle);
    }

    throw new ApiError(400, 'action doit valoir "revoquer" ou "expirer"');
  } catch (error) {
    return jsonError(error);
  }
}
