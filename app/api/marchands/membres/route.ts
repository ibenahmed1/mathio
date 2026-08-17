import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { hashSecret, getPasswordPolicyError } from '@/lib/auth';

// Gestion des membres d'équipe : réservée au titulaire du compte (pas à un
// membre déjà invité), pour éviter une chaîne d'invitations incontrôlée.
async function getOwnedMarchand(utilisateurId: string) {
  const marchand = await prisma.marchand.findUnique({ where: { utilisateurId } });
  if (!marchand) throw new ApiError(403, 'Seul le titulaire du compte peut gérer les membres de son équipe');
  return marchand;
}

export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnedMarchand(session.sub);

    const membres = await prisma.marchandMembre.findMany({
      where: { marchandId: marchand.id },
      orderBy: { dateAjout: 'desc' },
      include: { utilisateur: { select: { id: true, nomComplet: true, email: true, actif: true } } },
    });

    return NextResponse.json({ data: membres });
  } catch (error) {
    return jsonError(error);
  }
}

// Le titulaire invite un membre d'équipe avec un simple email + mot de
// passe (pas de téléphone) : il se connectera avec cet email (voir
// /api/auth/login, qui accepte téléphone OU email comme identifiant). Accès
// total aux données de la boutique une fois ajouté (pas de permissions fines
// pour ce scénario) — voir lib/marchand-scope.ts.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnedMarchand(session.sub);
    const body = await request.json();

    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';

    if (!nomComplet || !email || !secret) {
      throw new ApiError(400, 'nomComplet, email et secret sont requis');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, 'Email invalide');
    }
    const passwordError = getPasswordPolicyError(secret);
    if (passwordError) {
      throw new ApiError(400, passwordError);
    }

    const existant = await prisma.utilisateur.findUnique({ where: { email } });
    if (existant) {
      throw new ApiError(409, 'Cet email est déjà utilisé');
    }

    const motDePasseHash = await hashSecret(secret);

    const membre = await prisma.$transaction(async (tx) => {
      const utilisateur = await tx.utilisateur.create({
        data: { nomComplet, email, motDePasseHash, role: 'marchand', actif: true },
      });
      return tx.marchandMembre.create({
        data: { marchandId: marchand.id, utilisateurId: utilisateur.id },
        include: { utilisateur: { select: { id: true, nomComplet: true, email: true, actif: true } } },
      });
    });

    return NextResponse.json(membre, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
