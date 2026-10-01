import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  INVITATION_TOKEN_TTL_MS,
  generateResetToken,
  getPasswordPolicyError,
  hashSecret,
  hashSecretImpossible,
  isValidEmail,
  spaceOrigin,
} from '@/lib/auth';
import { sendInvitationEquipeMarchandEmail } from '@/lib/mailer';
import {
  SELECT_MEMBRE,
  contexteEquipe,
  exigerSansEscalade,
  journaliser,
  lireExpiration,
  lirePoste,
  roleDeLaBoutique,
  serialiserMembre,
} from '@/lib/equipe-marchand';
import { permissionsDuRole } from '@/lib/permissions-marchand';

// Ajout d'un membre à l'équipe de la boutique (écriture gardée par
// `equipe.gerer`, proxy). Deux modes, comme pour les pôles du back-office
// (POST /api/taches/equipes/[id]/membres) :
//
//  - `manuel` : le compte est créé avec le mot de passe saisi, que la personne
//    qui l'ajoute transmet elle-même (collaborateur à côté, pas d'email) ;
//  - `invitation` : le compte est créé sans mot de passe utilisable, et un lien
//    d'activation valable 7 jours part par email. Sans SMTP configuré (ou si
//    l'envoi échoue), le lien est renvoyé à l'écran pour être transmis à la
//    main — sinon le compte créé resterait inaccessible.
//
// Un email déjà connu est refusé (sauf ancien membre retiré, cf. plus bas) :
// un compte n'appartient qu'à une seule boutique (MarchandMembre.utilisateurId
// unique), et rattacher un compte actif sans son accord ouvrirait la porte à
// l'enrôlement d'un tiers dans une boutique qu'il ne connaît pas.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const body = await request.json();

    const mode = body.mode === 'manuel' ? 'manuel' : 'invitation';
    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';

    if (!nomComplet) throw new ApiError(400, 'Le nom complet est requis');
    if (nomComplet.length > 120) throw new ApiError(400, 'Nom trop long (120 caractères maximum)');
    if (!email || !isValidEmail(email)) throw new ApiError(400, 'Email invalide');
    if (mode === 'manuel') {
      const erreur = getPasswordPolicyError(secret);
      if (erreur) throw new ApiError(400, erreur);
    }

    const role = await roleDeLaBoutique(ctx.marchand.id, body.roleId);
    exigerSansEscalade(ctx, permissionsDuRole(role));
    const poste = lirePoste(body.poste);
    const accesExpireLe = lireExpiration(body.accesExpireLe);

    // Seule exception à la règle de l'email unique : l'ANCIEN MEMBRE d'une
    // équipe, retiré depuis. Son compte a été conservé (il signe ses actions
    // passées) mais désactivé, sans boutique ni lien d'équipe — il n'ouvre plus
    // rien. Le réemployer est la seule façon de réintégrer quelqu'un, sinon
    // son email resterait bloqué à jamais. Ses identifiants sont réinitialisés
    // comme pour un nouveau compte.
    const existant = await prisma.utilisateur.findUnique({
      where: { email },
      select: { id: true, role: true, actif: true, marchand: { select: { id: true } }, marchandMembre: { select: { id: true } } },
    });
    const ancienMembre =
      existant && existant.role === 'marchand' && !existant.actif && !existant.marchand && !existant.marchandMembre;
    if (existant && !ancienMembre) throw new ApiError(409, 'Cet email est déjà utilisé par un autre compte');

    const motDePasseHash = mode === 'manuel' ? await hashSecret(secret) : await hashSecretImpossible();
    const invitation = mode === 'invitation' ? generateResetToken(INVITATION_TOKEN_TTL_MS) : null;

    const membre = await prisma.$transaction(async (tx) => {
      const identite = {
        nomComplet,
        motDePasseHash,
        actif: true,
        resetTokenHash: invitation?.tokenHash ?? null,
        resetTokenExpire: invitation?.expiresAt ?? null,
      };
      const utilisateur = existant
        ? await tx.utilisateur.update({ where: { id: existant.id }, data: identite })
        : await tx.utilisateur.create({ data: { ...identite, email, role: 'marchand' } });
      return tx.marchandMembre.create({
        data: {
          marchandId: ctx.marchand.id,
          utilisateurId: utilisateur.id,
          roleId: role.id,
          poste,
          accesExpireLe,
          modeAjout: mode,
          ajoutePar: ctx.utilisateurId,
        },
        select: SELECT_MEMBRE,
      });
    });

    await journaliser(
      ctx,
      mode === 'manuel' ? 'membre_ajoute' : 'membre_invite',
      nomComplet,
      `${email} — rôle « ${role.nom} »`
    );

    if (!invitation) {
      return NextResponse.json({ membre: serialiserMembre(membre), mode }, { status: 201 });
    }

    const lienActivation = `${spaceOrigin('marchand')}/reinitialiser-mot-de-passe?token=${invitation.token}&invitation=1`;
    const invitant = await prisma.utilisateur.findUnique({
      where: { id: ctx.utilisateurId },
      select: { nomComplet: true },
    });

    let emailEnvoye = false;
    try {
      emailEnvoye = await sendInvitationEquipeMarchandEmail({
        to: email,
        nomComplet,
        nomBoutique: ctx.marchand.nomBoutique,
        invitant: invitant?.nomComplet ?? ctx.marchand.nomBoutique,
        nomRole: role.nom,
        activationUrl: lienActivation,
      });
    } catch (erreurEnvoi) {
      console.error('[equipe-marchand] envoi de l’invitation échoué', erreurEnvoi);
    }

    return NextResponse.json(
      {
        membre: serialiserMembre(membre),
        mode,
        emailEnvoye,
        // Rendu seulement si l'email n'est pas parti (cf. l'en-tête).
        lienActivation: emailEnvoye ? undefined : lienActivation,
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
