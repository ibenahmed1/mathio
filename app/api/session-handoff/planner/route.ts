import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { generateHandoffToken, spaceOrigin } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';

// Ouvre à l'admin une session sur la web app Planner, hébergée sur le domaine
// métier. Le formulaire de connexion du Planner refuse volontairement le rôle
// `admin` (cf. SPACE_LOGIN_ROLES, lib/auth.ts) pour que le mot de passe d'un
// compte back-office ne soit jamais saisi sur un domaine exposé à Internet :
// ce transfert lui conserve l'accès sans déplacer cette surface d'attaque.
//
// Ce n'est pas une impersonation — l'admin ouvre une session sur SON PROPRE
// compte, simplement dans un autre espace — d'où `impersonation: false` (le
// bandeau "vous consultez le compte de…" ne s'affiche pas) et une trace
// d'audit distincte de `impersonation_marchand`.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    if (session.space !== 'admin') {
      throw new ApiError(403, 'Action réservée au back-office');
    }

    const { token, tokenHash, expiresAt } = generateHandoffToken();
    await prisma.sessionHandoff.create({
      data: {
        tokenHash,
        espace: 'planner',
        impersonation: false,
        expireLe: expiresAt,
        utilisateurId: session.sub,
        emisParId: session.sub,
      },
    });

    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'acces_planner',
        cibleType: 'espace',
        cibleId: 'planner',
        adresseIp: getClientIp(request),
      },
    });

    return NextResponse.json({
      url: `${spaceOrigin('planner')}/api/session-handoff/consume?t=${token}`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
