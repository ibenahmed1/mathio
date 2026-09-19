import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { FENETRE_DEPRECIATION_MS } from '@/lib/plateforme-cles';
import {
  annulerExpiration,
  modifierCleApi,
  programmerExpiration,
  revoquerCleApi,
  supprimerCleApi,
} from '@/lib/plateformes';

// Les quatre gestes possibles sur une clé déjà émise, et ils ne se confondent
// pas :
//
//   action: "revoquer"           → refus DUR, immédiat. Pour une clé compromise.
//   action: "expirer"            → refus DOUX à l'échéance, précédé d'un en-tête
//                                  de dépréciation sur chaque appel de la
//                                  fenêtre de grâce. C'est la moitié « ancienne
//                                  clé » d'une rotation, et ça laisse au
//                                  partenaire le temps de déployer la nouvelle.
//   action: "annuler-expiration" → rotation abandonnée, la clé redevient sans
//                                  échéance. Refusé passé l'échéance.
//   action: "modifier"           → libellé et quota. PAS les scopes : voir
//                                  modifierCleApi (lib/plateformes.ts).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; cleId: string }> }) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id, cleId } = await params;
    const body = await request.json();

    const action = typeof body.action === 'string' ? body.action : '';

    // Chaque geste laisse la même trace : qui, quand, sur quelle plateforme.
    // Factorisé ici plutôt que recopié quatre fois — un oubli dans une branche
    // ne se verrait qu'en relisant un incident, c'est-à-dire trop tard.
    const tracer = (nom: string) =>
      prisma.auditLog.create({
        data: {
          adminId: session.sub,
          action: nom,
          cibleType: 'plateforme',
          cibleId: id,
          adresseIp: getClientIp(request),
        },
      });

    if (action === 'revoquer') {
      const cle = await revoquerCleApi(id, cleId);
      await tracer('cle_api.revocation');
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
      await tracer('cle_api.rotation');
      return NextResponse.json(cle);
    }

    if (action === 'annuler-expiration') {
      const cle = await annulerExpiration(id, cleId);
      await tracer('cle_api.rotation_annulee');
      return NextResponse.json(cle);
    }

    if (action === 'modifier') {
      const champs: { libelle?: string | null; quotaParMinute?: number } = {};

      if (body.libelle !== undefined) {
        if (body.libelle !== null && typeof body.libelle !== 'string') {
          throw new ApiError(400, 'libelle doit être une chaîne ou null');
        }
        champs.libelle = body.libelle;
      }

      if (body.quotaParMinute !== undefined) {
        const quota = Number(body.quotaParMinute);
        if (!Number.isInteger(quota) || quota <= 0) {
          throw new ApiError(400, 'quotaParMinute doit être un entier positif');
        }
        champs.quotaParMinute = quota;
      }

      const cle = await modifierCleApi(id, cleId, champs);
      // Le quota est un garde-fou d'exploitation : savoir qui l'a desserré, et
      // quand, est ce qu'on cherche après un emballement d'intégration.
      if (champs.quotaParMinute !== undefined) await tracer('cle_api.quota');
      return NextResponse.json(cle);
    }

    throw new ApiError(
      400,
      'action doit valoir "revoquer", "expirer", "annuler-expiration" ou "modifier"'
    );
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression d'une clé jamais utilisée — la clé émise par erreur, celle qu'on
// veut voir disparaître de l'écran plutôt que traîner en « révoquée ». Dès le
// premier appel, `supprimerCleApi` refuse et renvoie vers la révocation : les
// compteurs d'une clé qui a servi sont la seule matière d'une analyse de fuite
// (§ CleApiPlateforme, prisma/schema.prisma).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; cleId: string }> }
) {
  try {
    const session = await requirePermission('integrations:manage');
    const { id, cleId } = await params;

    // Tracé avant l'acte, comme la suppression d'une plateforme : une fois la
    // ligne partie, plus rien ne dirait qu'elle a existé.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'cle_api.suppression',
        cibleType: 'plateforme',
        cibleId: id,
        adresseIp: getClientIp(request),
      },
    });

    await supprimerCleApi(id, cleId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
