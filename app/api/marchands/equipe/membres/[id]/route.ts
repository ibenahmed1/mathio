import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  SELECT_MEMBRE,
  contexteEquipe,
  exigerPriseSurMembre,
  exigerSansEscalade,
  journaliser,
  lireExpiration,
  lirePoste,
  membreDeLaBoutique,
  roleDeLaBoutique,
  serialiserMembre,
} from '@/lib/equipe-marchand';
import { permissionsDuRole } from '@/lib/permissions-marchand';

// Modification d'un membre : rôle, poste, accès temporaire, suspension /
// réactivation, nom. Chaque champ est facultatif ; seuls ceux fournis
// changent. Toutes les règles de lib/equipe-marchand.ts s'appliquent.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const membre = await membreDeLaBoutique(ctx, id);
    exigerPriseSurMembre(ctx, { utilisateurId: membre.utilisateurId, role: membre.role });

    const body = await request.json();
    const dataMembre: {
      roleId?: string;
      poste?: string | null;
      accesExpireLe?: Date | null;
    } = {};
    const dataUtilisateur: { actif?: boolean; nomComplet?: string } = {};
    const evenements: { action: Parameters<typeof journaliser>[1]; details?: string }[] = [];

    if ('roleId' in body && body.roleId !== membre.roleId) {
      const role = await roleDeLaBoutique(ctx.marchand.id, body.roleId);
      exigerSansEscalade(ctx, permissionsDuRole(role));
      dataMembre.roleId = role.id;
      evenements.push({ action: 'role_change', details: `« ${membre.role.nom} » → « ${role.nom} »` });
    }
    if ('poste' in body) {
      dataMembre.poste = lirePoste(body.poste);
    }
    if ('accesExpireLe' in body) {
      dataMembre.accesExpireLe = lireExpiration(body.accesExpireLe);
      evenements.push({
        action: 'membre_modifie',
        details: dataMembre.accesExpireLe
          ? `Accès limité jusqu’au ${dataMembre.accesExpireLe.toLocaleDateString('fr-FR', { timeZone: 'Africa/Casablanca' })}`
          : 'Accès sans limite de durée',
      });
    }
    if ('nomComplet' in body) {
      const nom = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
      if (!nom) throw new ApiError(400, 'Le nom complet est requis');
      if (nom.length > 120) throw new ApiError(400, 'Nom trop long (120 caractères maximum)');
      if (nom !== membre.utilisateur.nomComplet) {
        dataUtilisateur.nomComplet = nom;
        evenements.push({ action: 'membre_modifie', details: `Renommé en « ${nom} »` });
      }
    }
    if ('actif' in body) {
      if (typeof body.actif !== 'boolean') throw new ApiError(400, 'Statut invalide');
      if (body.actif !== membre.utilisateur.actif) {
        dataUtilisateur.actif = body.actif;
        evenements.push({ action: body.actif ? 'membre_reactive' : 'membre_suspendu' });
      }
    }
    if ('poste' in body && dataMembre.poste !== membre.poste) {
      evenements.push({ action: 'membre_modifie', details: dataMembre.poste ? `Poste : ${dataMembre.poste}` : 'Poste retiré' });
    }

    const misAJour = await prisma.$transaction(async (tx) => {
      if (Object.keys(dataUtilisateur).length > 0) {
        await tx.utilisateur.update({ where: { id: membre.utilisateurId }, data: dataUtilisateur });
      }
      return tx.marchandMembre.update({ where: { id }, data: dataMembre, select: SELECT_MEMBRE });
    });

    const cible = dataUtilisateur.nomComplet ?? membre.utilisateur.nomComplet;
    for (const e of evenements) await journaliser(ctx, e.action, cible, e.details);

    return NextResponse.json({ membre: serialiserMembre(misAJour) });
  } catch (error) {
    return jsonError(error);
  }
}

// Retrait d'un membre : le lien à la boutique est supprimé et le compte
// désactivé. L'Utilisateur n'est pas supprimé : il reste l'auteur de ses
// actions passées (historiques de statut, commentaires, journal d'équipe).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const membre = await membreDeLaBoutique(ctx, id);
    exigerPriseSurMembre(ctx, { utilisateurId: membre.utilisateurId, role: membre.role });

    await prisma.$transaction([
      prisma.marchandMembre.delete({ where: { id } }),
      prisma.utilisateur.update({
        where: { id: membre.utilisateurId },
        // Le jeton d'invitation encore ouvert est invalidé : sans quoi le lien
        // reçu permettrait toujours de choisir un mot de passe.
        data: { actif: false, resetTokenHash: null, resetTokenExpire: null },
      }),
    ]);

    await journaliser(ctx, 'membre_retire', membre.utilisateur.nomComplet, membre.utilisateur.email);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
