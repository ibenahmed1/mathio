import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { detaillerPlateforme, majPlateforme } from '@/lib/plateformes';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('integrations:manage');
    const { id } = await params;

    const detail = await detaillerPlateforme(id);
    if (!detail) throw new ApiError(404, 'Plateforme introuvable');

    return NextResponse.json(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id } = await params;
    const body = await request.json();

    const champs: { nom?: string; actif?: boolean } = {};

    if (body.nom !== undefined) {
      const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
      if (!nom) throw new ApiError(400, 'nom ne peut pas être vide');
      champs.nom = nom;
    }

    // Désactiver une plateforme coupe TOUTES ses clés d'un coup, sans les
    // révoquer : c'est l'interrupteur à tirer pendant un incident, quand on ne
    // sait pas encore laquelle est en cause et qu'on veut pouvoir revenir en
    // arrière sans réémettre.
    if (body.actif !== undefined) {
      if (typeof body.actif !== 'boolean') throw new ApiError(400, 'actif doit être un booléen');
      champs.actif = body.actif;
    }

    if (Object.keys(champs).length === 0) {
      throw new ApiError(400, 'Rien à modifier : fournir nom et/ou actif');
    }

    const misAJour = await majPlateforme(id, champs);

    // Suspendre une plateforme coupe toutes ses clés d'un coup : c'est le geste
    // d'incident, et il manquait au journal d'audit alors que l'émission et la
    // révocation d'une clé y figuraient. Savoir QUI a coupé — et quand — est
    // exactement ce qu'on cherche en relisant un incident.
    if (champs.actif !== undefined) {
      await prisma.auditLog.create({
        data: {
          adminId: session.sub,
          action: champs.actif ? 'plateforme.reactivation' : 'plateforme.suspension',
          cibleType: 'plateforme',
          cibleId: id,
          adresseIp: getClientIp(request),
        },
      });
    }

    return NextResponse.json(misAJour);
  } catch (error) {
    return jsonError(error);
  }
}
