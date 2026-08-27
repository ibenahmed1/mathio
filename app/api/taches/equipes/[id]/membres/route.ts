import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  hashSecret,
  hashSecretImpossible,
  generateResetToken,
  INVITATION_TOKEN_TTL_MS,
  ROLES_KANBAN_UNIQUEMENT,
  getPasswordPolicyError,
  spaceOrigin,
} from '@/lib/auth';
import { sendInvitationEmail } from '@/lib/mailer';
import type { Role } from '@/app/generated/prisma/enums';

const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// Composition des équipes (ajout/retrait/invitation de membres) — les rôles
// cantonnés au Kanban (design, gestionnaire_hub) n'y ont pas accès : ils
// utilisent le tableau mais ne pilotent pas l'organisation des pôles.
const ROLES_GESTION_EQUIPES: Role[] = ROLES_BACKOFFICE.filter(
  (r) => !ROLES_KANBAN_UNIQUEMENT.includes(r)
);

const SELECT_MEMBRE = {
  id: true,
  dateAjout: true,
  utilisateur: { select: { id: true, nomComplet: true, email: true, role: true, actif: true } },
} as const;

async function getEquipe(id: string) {
  const equipe = await prisma.equipeTache.findUnique({ where: { id } });
  if (!equipe) throw new ApiError(404, 'Équipe introuvable');
  return equipe;
}

// Remplace en un appel la composition d'une équipe (§ workflow d'assignation,
// case à cocher "multi-select" côté UI) : synchronise vers l'ensemble
// utilisateurIds fourni plutôt que d'exiger un appel par membre ajouté/retiré.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(ROLES_GESTION_EQUIPES);
    const { id } = await params;
    await getEquipe(id);

    const body = await request.json();
    const utilisateurIds: string[] = Array.isArray(body.utilisateurIds)
      ? body.utilisateurIds.filter((v: unknown) => typeof v === 'string')
      : [];

    const actuels = await prisma.equipeTacheMembre.findMany({ where: { equipeId: id } });
    const actuelsIds = new Set(actuels.map((m) => m.utilisateurId));
    const voulusIds = new Set(utilisateurIds);

    const aRetirer = actuels.filter((m) => !voulusIds.has(m.utilisateurId)).map((m) => m.id);
    const aAjouter = utilisateurIds.filter((uid) => !actuelsIds.has(uid));

    await prisma.$transaction([
      prisma.equipeTacheMembre.deleteMany({ where: { id: { in: aRetirer } } }),
      ...aAjouter.map((utilisateurId) =>
        prisma.equipeTacheMembre.create({ data: { equipeId: id, utilisateurId } })
      ),
    ]);

    const membres = await prisma.equipeTacheMembre.findMany({
      where: { equipeId: id },
      orderBy: { dateAjout: 'asc' },
      select: SELECT_MEMBRE,
    });

    return NextResponse.json({ data: membres });
  } catch (error) {
    return jsonError(error);
  }
}

// Invitation d'une personne au pôle (§ workflow d'assignation). Trois cas,
// dans cet ordre :
//
//  1. l'email correspond déjà à un compte de l'espace admin → simple
//     rattachement au pôle, sans toucher au compte ni au mot de passe ;
//  2. `secret` fourni → création immédiate avec ce mot de passe (mode hors
//     ligne : l'invitant le communique lui-même, utile quand le SMTP n'est pas
//     configuré ou que la personne est à côté) ;
//  3. `secret` absent → invitation par lien : le compte est créé sans mot de
//     passe utilisable, et un lien d'activation valable 7 jours part par email.
//
// Le lien vise TOUJOURS l'origine de l'espace admin (spaceOrigin('admin')) et
// non l'hôte de la requête : depuis la séparation par domaines, c'est le seul
// hôte où le cookie de session admin peut être posé. Un lien construit sur un
// autre domaine mènerait à un 404 du proxy.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(ROLES_GESTION_EQUIPES);
    const { id } = await params;
    const equipe = await getEquipe(id);

    const body = await request.json();
    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const secret = typeof body.secret === 'string' && body.secret ? body.secret : null;
    const role = body.role as Role | undefined;

    if (!email) {
      throw new ApiError(400, "L'email est requis");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, 'Email invalide');
    }

    const existant = await prisma.utilisateur.findUnique({ where: { email } });

    // --- Cas 1 : compte back-office existant --------------------------------
    // Rattachement plutôt que 409 : après le déploiement, la manœuvre la plus
    // fréquente est d'ajouter au pôle quelqu'un qui a déjà un accès admin.
    if (existant) {
      if (!ROLES_BACKOFFICE.includes(existant.role)) {
        throw new ApiError(
          409,
          "Cet email appartient à un compte hors back-office (marchand ou terrain) : il ne peut pas rejoindre un pôle."
        );
      }
      const dejaMembre = await prisma.equipeTacheMembre.findUnique({
        where: { equipeId_utilisateurId: { equipeId: id, utilisateurId: existant.id } },
      });
      if (dejaMembre) {
        throw new ApiError(409, 'Cette personne fait déjà partie du pôle');
      }
      const membre = await prisma.equipeTacheMembre.create({
        data: { equipeId: id, utilisateurId: existant.id },
        select: SELECT_MEMBRE,
      });
      return NextResponse.json({ ...membre, mode: 'rattachement' }, { status: 201 });
    }

    // --- Cas 2 et 3 : création du compte ------------------------------------
    if (!nomComplet || !role) {
      throw new ApiError(400, 'nomComplet et role sont requis pour créer un compte');
    }
    if (!ROLES_BACKOFFICE.includes(role)) {
      throw new ApiError(400, `Rôle invalide. Valeurs possibles : ${ROLES_BACKOFFICE.join(', ')}`);
    }
    if (secret) {
      const passwordError = getPasswordPolicyError(secret);
      if (passwordError) {
        throw new ApiError(400, passwordError);
      }
    }

    const motDePasseHash = secret ? await hashSecret(secret) : await hashSecretImpossible();
    const invitation = secret ? null : generateResetToken(INVITATION_TOKEN_TTL_MS);

    const membre = await prisma.$transaction(async (tx) => {
      const utilisateur = await tx.utilisateur.create({
        data: {
          nomComplet,
          email,
          motDePasseHash,
          role,
          actif: true,
          resetTokenHash: invitation?.tokenHash ?? null,
          resetTokenExpire: invitation?.expiresAt ?? null,
        },
      });
      return tx.equipeTacheMembre.create({
        data: { equipeId: id, utilisateurId: utilisateur.id },
        select: SELECT_MEMBRE,
      });
    });

    if (!invitation) {
      return NextResponse.json({ ...membre, mode: 'mot_de_passe_defini' }, { status: 201 });
    }

    const lienActivation = `${spaceOrigin('admin')}/reinitialiser-mot-de-passe?token=${invitation.token}`;

    // Le compte est déjà créé à ce stade : un échec SMTP (identifiants
    // périmés, relais injoignable) ne doit pas se solder par un 500 qui
    // laisserait un compte inaccessible et sans lien. On dégrade vers le même
    // cas que « SMTP non configuré » : le lien remonte à l'invitant.
    let envoye = false;
    try {
      envoye = await sendInvitationEmail(email, nomComplet, lienActivation, equipe.nom);
    } catch (erreurEnvoi) {
      console.error('[invitation] envoi email échoué', erreurEnvoi);
    }

    // Le lien n'est renvoyé que si l'email n'est pas parti : sans SMTP
    // configuré, l'invitant doit pouvoir le copier et le transmettre lui-même,
    // sinon le compte créé reste inaccessible. Quand l'email part, on ne le
    // rend pas — il n'a pas à traîner dans un onglet ouvert.
    return NextResponse.json(
      {
        ...membre,
        mode: 'invitation',
        emailEnvoye: envoye,
        lienActivation: envoye ? undefined : lienActivation,
        expireLe: invitation.expiresAt,
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
