import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { signSession, getSessionCookieName, SESSION_MAX_AGE_SECONDS } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';

// Permet à un admin d'accéder directement à l'espace d'un marchand (support,
// dépannage) sans connaître son mot de passe : on émet une vraie session
// marchand (même mécanisme que /api/auth/login, sans vérification de
// secret) et on la pose sur le cookie `pd_session_marchand`. Le cookie
// `pd_session_admin` n'est jamais touché : l'admin garde son propre onglet
// authentifié et peut revenir en arrière à tout moment.
//
// Refusé si le compte n'est pas actif — cohérent avec la connexion normale
// (Utilisateur.actif est synchronisé sur Marchand.statut, voir
// /api/marchands/[id]/statut) : un compte en attente de validation ne doit
// pas être "visitable" comme s'il était opérationnel.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    const marchand = await prisma.marchand.findUnique({
      where: { id },
      include: { utilisateur: true },
    });
    if (!marchand) {
      throw new ApiError(404, 'Marchand introuvable');
    }
    if (marchand.statut !== 'actif' || !marchand.utilisateur.actif) {
      throw new ApiError(409, 'Ce compte marchand n\'est pas actif — approuvez-le avant d\'y accéder.');
    }

    const token = await signSession({ sub: marchand.utilisateurId, role: 'marchand' });

    // Traçabilité : table AuditLog dédiée (voir prisma/schema.prisma) plutôt
    // qu'un simple console.info — nécessaire pour établir les responsabilités
    // en cas de modification frauduleuse sur le compte d'un marchand pendant
    // une session d'impersonation.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'impersonation_marchand',
        cibleType: 'marchand',
        cibleId: marchand.id,
        adresseIp: getClientIp(request),
      },
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(getSessionCookieName('marchand'), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
