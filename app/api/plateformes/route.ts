import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { creerPlateforme, listerPlateformes, normaliserCodePlateforme } from '@/lib/plateformes';

// Administration des plateformes partenaires (§ /admin/integrations).
//
// `requirePermission` et non `requireUser([...])` : l'accès se décrit ici par
// une permission, pas par une liste de rôles — c'est la forme prévue par
// lib/api-utils.ts pour ce cas. `integrations:manage` est une clé PROPRE,
// détenue par le seul rôle admin par défaut (cf. lib/permissions.ts) : émettre
// une clé d'API donne à une machine tierce le droit de créer des marchands
// déjà validés et de déposer des colis.

export async function GET() {
  try {
    await requirePermission('integrations:manage');
    return NextResponse.json(await listerPlateformes());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission('integrations:manage');
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    if (!nom) throw new ApiError(400, 'nom est requis');

    const code = normaliserCodePlateforme(body.code);

    // Rattachement facultatif à un transporteur : c'est lui, et lui seul, qui
    // fait de ce compte machine un compte de PRESTATAIRE plutôt qu'un canal de
    // vente. Absent par défaut — le cas historique reste Shipeh.
    const prestataireId = typeof body.prestataireId === 'string' ? body.prestataireId.trim() : '';

    const creee = await creerPlateforme(code, nom, prestataireId || null);

    // Créer une plateforme crée aussi un compte de service en base. C'est le
    // point de départ de tout accès machine — il a sa place au journal d'audit,
    // au même titre que les clés qu'on émettra ensuite.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'plateforme.creation',
        cibleType: 'plateforme',
        cibleId: creee.id,
        adresseIp: getClientIp(request),
      },
    });

    return NextResponse.json(creee, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
