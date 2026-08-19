import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { generateHandoffToken, spaceOrigin } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';

// Permet à un admin d'accéder directement à l'espace d'un marchand (support,
// dépannage) sans connaître son mot de passe.
//
// Depuis la séparation par domaines, cette route ne pose PLUS de cookie
// elle-même : elle tourne sur le domaine du back-office, et le cookie de
// session marchand est lié à l'hôte du domaine métier (préfixe `__Host-`, cf.
// lib/auth.ts) — un domaine ne peut pas écrire de cookie pour un autre, et
// c'est précisément l'isolation recherchée. Elle émet donc un jeton de
// transfert à usage unique (60 s) que le navigateur échange contre une vraie
// session sur l'hôte marchand (GET /api/session-handoff/consume).
//
// Le changement est aussi un gain de sécurité en soi : là où l'ancienne
// version posait en aveugle une session de 24 h, le jeton est unique, expire
// en une minute, et n'existe en base que sous forme de hash.
//
// La session admin n'est jamais touchée : elle vit sur l'autre domaine.
//
// Refusé si le compte n'est pas actif — cohérent avec la connexion normale
// (Utilisateur.actif est synchronisé sur Marchand.statut, voir
// /api/marchands/[id]/statut) : un compte en attente de validation ne doit
// pas être "visitable" comme s'il était opérationnel.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    // L'émission d'un transfert n'a de sens que depuis le back-office : la
    // refuser ailleurs empêche qu'une session admin obtenue sur un autre
    // domaine (aujourd'hui impossible, demain peut-être) serve de tremplin.
    if (session.space !== 'admin') {
      throw new ApiError(403, 'Action réservée au back-office');
    }

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

    const { token, tokenHash, expiresAt } = generateHandoffToken();
    await prisma.sessionHandoff.create({
      data: {
        tokenHash,
        espace: 'marchand',
        impersonation: true,
        expireLe: expiresAt,
        utilisateurId: marchand.utilisateurId,
        emisParId: session.sub,
      },
    });

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

    return NextResponse.json({
      url: `${spaceOrigin('marchand')}/api/session-handoff/consume?t=${token}`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
