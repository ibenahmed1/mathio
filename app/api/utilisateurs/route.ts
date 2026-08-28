import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  hashSecret,
  getPasswordPolicyError,
  normalizePhoneMaroc,
  ROLE_PERMISSIONS,
  sanitizePermissions,
} from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// Rôles créables via cet endpoint : les comptes équipe internes (RF-22).
// "marchand" passe par /api/marchands/inscription (auto-inscription) et
// "admin" ne se crée pas via l'API pour ce scénario. "design"/"gestionnaire_hub"
// sont cantonnés à l'outil Kanban (ROLES_KANBAN_UNIQUEMENT, lib/auth.ts) et
// "agent_hub" à la réception de dépôt (ROLES_HUB_UNIQUEMENT).
const ROLES_EQUIPE: Role[] = [
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'ramasseur',
  'livreur',
  'design',
  'gestionnaire_hub',
  'agent_hub',
  'planner',
];

// § /admin/scan/reception + /admin/bon-distribution : un agent_hub, un planner ou un
// livreur doit obligatoirement être rattaché à un Hub — validé ici (POST) et
// dans PATCH /api/utilisateurs/[id].
const ROLES_AVEC_HUB: Role[] = ['agent_hub', 'livreur', 'planner'];

// Rôles terrain : formulaire de création riche (photo, CIN, zones, banque…),
// mot de passe saisi manuellement par l'admin (pas d'auto-génération, cf.
// maquette "Ajouter Utilisateur" — contrairement aux autres rôles ci-dessus).
const ROLES_TERRAIN: Role[] = ['ramasseur', 'livreur'];

// Modérateur a une simple photo de profil (maquette "Ajouter Utilisateur"),
// sans le reste des champs terrain (CIN, banque, frais…).
const ROLES_AVEC_PHOTO: Role[] = ['ramasseur', 'livreur', 'moderateur'];

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
        email: true,
        role: true,
        actif: true,
        dateCreation: true,
        derniereConnexion: true,
        cin: true,
        photoUrl: true,
        zonePrincipale: true,
        zoneSecondaire: true,
        adresse: true,
        nomBanque: true,
        numeroCompte: true,
        fraisLivraison: true,
        fraisRefus: true,
        cinRectoUrl: true,
        cinVersoUrl: true,
        ribPhotoUrl: true,
        rolesSupplementaires: true,
        permissions: true,
        hubId: true,
        hub: { select: { id: true, nom: true } },
      },
    });

    return NextResponse.json({ data: utilisateurs });
  } catch (error) {
    return jsonError(error);
  }
}

// RF-22 : création d'un compte équipe (superviseur, ramasseur, etc.)
// par l'admin. Créé directement actif (l'admin l'a créé lui-même de façon
// délibérée) — contrairement à l'auto-inscription marchand qui reste en attente.
//
// Identifiants : l'identifiant de connexion est le téléphone (donnée réelle,
// ne peut pas être "généré" — c'est le seul champ que l'admin doit fournir
// lui-même).
//
// Mot de passe : pour tous les rôles, la maquette "Ajouter Utilisateur"
// impose une saisie manuelle + confirmation par l'admin lui-même (deux
// champs) — jamais de génération automatique.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const telephoneRaw = typeof body.telephone === 'string' ? body.telephone.trim() : '';
    const role = body.role as Role | undefined;

    if (!nomComplet || !telephoneRaw || !role) {
      throw new ApiError(400, 'nomComplet, telephone et role sont requis');
    }
    if (!ROLES_EQUIPE.includes(role)) {
      throw new ApiError(400, `Rôle invalide. Valeurs possibles : ${ROLES_EQUIPE.join(', ')}`);
    }

    const telephone = normalizePhoneMaroc(telephoneRaw);
    if (!telephone) {
      throw new ApiError(400, 'Numéro de téléphone invalide (format marocain attendu, ex. 06XXXXXXXX)');
    }

    const existingTelephone = await prisma.utilisateur.findUnique({ where: { telephone } });
    if (existingTelephone) {
      throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé');
    }

    const estTerrain = ROLES_TERRAIN.includes(role);
    const avecPhoto = ROLES_AVEC_PHOTO.includes(role);
    const avecHub = ROLES_AVEC_HUB.includes(role);

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const cin = typeof body.cin === 'string' ? body.cin.trim() : '';

    if (estTerrain) {
      if (!email) {
        throw new ApiError(400, 'email est requis pour un compte livreur/ramasseur');
      }
      if (!cin) {
        throw new ApiError(400, 'cin est requis pour un compte livreur/ramasseur');
      }
    }

    // RF AGENT_HUB / LIVREUR : doit obligatoirement être rattaché à un Hub
    // (Utilisateur.hubId).
    let hubId: string | null = null;
    if (avecHub) {
      hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';
      if (!hubId) {
        throw new ApiError(400, 'hubId est requis pour ce rôle');
      }
      const hub = await prisma.hub.findUnique({ where: { id: hubId } });
      if (!hub) {
        throw new ApiError(400, 'Hub introuvable');
      }
    }

    const secret = typeof body.secret === 'string' ? body.secret : '';
    const confirmSecret = typeof body.confirmSecret === 'string' ? body.confirmSecret : '';
    if (!secret || !confirmSecret) {
      throw new ApiError(400, 'secret et confirmSecret sont requis');
    }
    const passwordError = getPasswordPolicyError(secret);
    if (passwordError) {
      throw new ApiError(400, passwordError);
    }
    if (secret !== confirmSecret) {
      throw new ApiError(400, 'Les mots de passe ne correspondent pas');
    }

    if (email) {
      const existingEmail = await prisma.utilisateur.findUnique({ where: { email } });
      if (existingEmail) {
        throw new ApiError(409, 'Cette adresse électronique est déjà utilisée');
      }
    }

    const motDePasseHash = await hashSecret(secret);

    const data: Prisma.UtilisateurCreateInput = {
      nomComplet,
      telephone,
      motDePasseHash,
      role,
      actif: true,
      // Permissions du back-office (§ lib/permissions.ts). Le formulaire les
      // envoie toujours pour un compte interne — pré-cochées sur le jeu par
      // défaut du rôle, puis ajustées. À défaut (appel API direct, script), on
      // retombe sur ce même jeu par défaut plutôt que sur un compte muet, qui
      // n'ouvrirait aucun écran. Un compte terrain n'en reçoit aucune.
      permissions: estTerrain
        ? []
        : body.permissions === undefined
          ? (ROLE_PERMISSIONS[role] ?? [])
          : sanitizePermissions(body.permissions),
    };

    if (email) {
      data.email = email;
    }

    if (avecPhoto) {
      data.photoUrl = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl : null;
    }

    if (estTerrain) {
      data.cin = cin;
      data.zonePrincipale = typeof body.zonePrincipale === 'string' && body.zonePrincipale ? body.zonePrincipale : null;
      data.zoneSecondaire = typeof body.zoneSecondaire === 'string' && body.zoneSecondaire ? body.zoneSecondaire : null;
      data.adresse = typeof body.adresse === 'string' && body.adresse ? body.adresse : null;
      data.nomBanque = typeof body.nomBanque === 'string' && body.nomBanque ? body.nomBanque : null;
      data.numeroCompte = typeof body.numeroCompte === 'string' && body.numeroCompte ? body.numeroCompte : null;
      data.fraisLivraison =
        body.fraisLivraison !== undefined && body.fraisLivraison !== null && body.fraisLivraison !== ''
          ? Number(body.fraisLivraison)
          : null;
      data.fraisRefus =
        body.fraisRefus !== undefined && body.fraisRefus !== null && body.fraisRefus !== ''
          ? Number(body.fraisRefus)
          : null;
      data.cinRectoUrl = typeof body.cinRectoUrl === 'string' && body.cinRectoUrl ? body.cinRectoUrl : null;
      data.cinVersoUrl = typeof body.cinVersoUrl === 'string' && body.cinVersoUrl ? body.cinVersoUrl : null;
      data.ribPhotoUrl = typeof body.ribPhotoUrl === 'string' && body.ribPhotoUrl ? body.ribPhotoUrl : null;
    }

    if (avecHub) {
      data.hub = { connect: { id: hubId! } };
    }

    const utilisateur = await prisma.utilisateur.create({
      data,
      select: { id: true, nomComplet: true, telephone: true, role: true, actif: true, hubId: true },
    });

    return NextResponse.json(utilisateur, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
