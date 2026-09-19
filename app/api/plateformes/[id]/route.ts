import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import {
  type ChampsPlateforme,
  detaillerPlateforme,
  majPlateforme,
  normaliserCodePlateforme,
  supprimerPlateforme,
} from '@/lib/plateformes';

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

    const champs: ChampsPlateforme = {};

    if (body.nom !== undefined) {
      const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
      if (!nom) throw new ApiError(400, 'nom ne peut pas être vide');
      champs.nom = nom;
    }

    // Le code se normalise ici comme à la création : même contrainte, même
    // message. Quand il a encore le droit de changer est en revanche une
    // question d'état du compte, donc une règle métier — elle vit dans
    // majPlateforme, pas dans ce handler.
    if (body.code !== undefined) {
      champs.code = normaliserCodePlateforme(body.code);
    }

    // Rattachement à un transporteur : une chaîne rattache ou déplace, `null`
    // détache. La distinction avec `undefined` porte tout le sens — « ne pas
    // toucher » et « détacher » ne sont pas le même geste — d'où la lecture
    // explicite du `null` plutôt qu'un `|| ''` qui les confondrait.
    if (body.prestataireId !== undefined) {
      if (body.prestataireId === null) {
        champs.prestataireId = null;
      } else if (typeof body.prestataireId === 'string') {
        champs.prestataireId = body.prestataireId.trim() || null;
      } else {
        throw new ApiError(400, 'prestataireId doit être une chaîne ou null');
      }
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
      throw new ApiError(400, 'Rien à modifier : fournir nom, code, prestataireId et/ou actif');
    }

    const misAJour = await majPlateforme(id, champs);

    // Suspendre une plateforme coupe toutes ses clés d'un coup : c'est le geste
    // d'incident, et il manquait au journal d'audit alors que l'émission et la
    // révocation d'une clé y figuraient. Savoir QUI a coupé — et quand — est
    // exactement ce qu'on cherche en relisant un incident.
    //
    // Le rattachement y figure pour une raison voisine : il décide du périmètre
    // des clés à émettre ensuite, donc de ce qu'un tiers pourra atteindre.
    const aTracer: string[] = [];
    if (champs.actif !== undefined) {
      aTracer.push(champs.actif ? 'plateforme.reactivation' : 'plateforme.suspension');
    }
    if (champs.prestataireId !== undefined) aTracer.push('plateforme.rattachement');

    for (const action of aTracer) {
      await prisma.auditLog.create({
        data: {
          adminId: session.sub,
          action,
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

// Suppression définitive du compte machine et de son compte de service. Les
// conditions — et la raison pour laquelle elles ne sont pas négociables — sont
// dans `supprimerPlateforme` (lib/plateformes.ts).
//
// Le journal d'audit est écrit AVANT la suppression : `cibleId` désignerait
// sinon une ligne qui n'existe plus, et l'écriture elle-même pourrait échouer
// après que la cible a disparu. Un journal qui mentionne une suppression qui
// n'a finalement pas eu lieu est moins grave qu'une suppression sans trace.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id } = await params;

    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'plateforme.suppression',
        cibleType: 'plateforme',
        cibleId: id,
        adresseIp: getClientIp(request),
      },
    });

    await supprimerPlateforme(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
