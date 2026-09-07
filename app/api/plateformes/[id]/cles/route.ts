import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { ENVIRONNEMENTS, type EnvironnementCle } from '@/lib/plateforme-cles';
import { creerCleApi } from '@/lib/plateformes';

// Émission d'une clé d'API.
//
// La réponse porte `cleComplete`, et c'est la SEULE fois qu'elle existera :
// seul son hash part en base (cf. CleApiPlateforme.secretHash). Perdue, une
// clé ne se retrouve pas — elle se réémet.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id } = await params;
    const body = await request.json();

    const environnement = typeof body.environnement === 'string' ? body.environnement : '';
    if (!ENVIRONNEMENTS.includes(environnement as EnvironnementCle)) {
      throw new ApiError(400, `environnement doit valoir ${ENVIRONNEMENTS.join(' ou ')}`);
    }

    const quotaBrut = body.quotaParMinute;
    const quotaParMinute = quotaBrut === undefined || quotaBrut === null ? undefined : Number(quotaBrut);
    if (quotaParMinute !== undefined && (!Number.isInteger(quotaParMinute) || quotaParMinute <= 0)) {
      throw new ApiError(400, 'quotaParMinute doit être un entier positif');
    }

    const { cleComplete, cle } = await creerCleApi(id, {
      environnement: environnement as EnvironnementCle,
      scopes: body.scopes,
      libelle: typeof body.libelle === 'string' ? body.libelle : null,
      quotaParMinute,
    });

    // Émettre une clé est une action sensible au même titre qu'une
    // impersonation : elle ouvre un accès machine durable. Le préfixe suffit à
    // désigner la clé dans le journal — le secret, lui, ne doit apparaître
    // nulle part ailleurs que dans cette réponse.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'cle_api.creation',
        cibleType: 'plateforme',
        cibleId: id,
        adresseIp: getClientIp(request),
      },
    });

    return NextResponse.json({ cleComplete, cle }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
