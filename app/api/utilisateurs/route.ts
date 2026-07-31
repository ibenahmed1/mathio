import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { generateTemporarySecret, hashSecret } from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// Rôles créables via cet endpoint : les comptes équipe internes (RF-22).
// "marchand" passe par /api/marchands/inscription (auto-inscription) et
// "admin" ne se crée pas via l'API pour ce scénario.
const ROLES_EQUIPE: Role[] = ['agent_confirmation', 'ramasseur', 'livreur', 'finance', 'sav'];

export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    const roleParam = request.nextUrl.searchParams.get('role');

    if (roleParam && !ROLES_EQUIPE.includes(roleParam as Role)) {
      throw new ApiError(400, `Rôle invalide : ${roleParam}`);
    }

    const utilisateurs = await prisma.utilisateur.findMany({
      where: roleParam ? { role: roleParam as Role } : { role: { in: ROLES_EQUIPE } },
      orderBy: { dateCreation: 'desc' },
      select: {
        id: true,
        nomComplet: true,
        telephone: true,
        role: true,
        actif: true,
        dateCreation: true,
        derniereConnexion: true,
      },
    });

    return NextResponse.json({ data: utilisateurs });
  } catch (error) {
    return jsonError(error);
  }
}

// RF-22 : création d'un compte équipe (agent de confirmation, ramasseur, etc.)
// par l'admin. Créé directement actif (l'admin l'a créé lui-même de façon
// délibérée) — contrairement à l'auto-inscription marchand qui reste en attente.
//
// Génération automatique des identifiants : l'identifiant de connexion est
// le téléphone (donnée réelle, ne peut pas être "généré" — c'est le seul
// champ que l'admin doit fournir lui-même). Le secret (mot de passe/PIN),
// lui, est optionnel : si l'admin ne le fournit pas, le système en génère un
// automatiquement (même mécanisme que /api/utilisateurs/:id/reinitialiser-
// mot-de-passe), renvoyé une seule fois en clair pour être communiqué à la
// personne concernée — ça évite les mots de passe faibles/réutilisés tapés à
// la main, et accélère l'onboarding des livreurs/ramasseurs.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const telephone = typeof body.telephone === 'string' ? body.telephone.trim() : '';
    const role = body.role as Role | undefined;

    if (!nomComplet || !telephone || !role) {
      throw new ApiError(400, 'nomComplet, telephone et role sont requis');
    }
    if (!ROLES_EQUIPE.includes(role)) {
      throw new ApiError(400, `Rôle invalide. Valeurs possibles : ${ROLES_EQUIPE.join(', ')}`);
    }

    const existing = await prisma.utilisateur.findUnique({ where: { telephone } });
    if (existing) {
      throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé');
    }

    let secret = typeof body.secret === 'string' ? body.secret : '';
    let secretGenere = false;
    if (!secret) {
      secret = generateTemporarySecret();
      secretGenere = true;
    } else if (secret.length < 4) {
      throw new ApiError(400, 'Le secret (mot de passe/PIN) doit contenir au moins 4 caractères');
    }

    const motDePasseHash = await hashSecret(secret);
    const utilisateur = await prisma.utilisateur.create({
      data: { nomComplet, telephone, motDePasseHash, role, actif: true },
      select: { id: true, nomComplet: true, telephone: true, role: true, actif: true },
    });

    return NextResponse.json(
      { ...utilisateur, secretTemporaire: secretGenere ? secret : undefined },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
