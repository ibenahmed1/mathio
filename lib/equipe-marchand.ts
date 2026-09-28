import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import type { SessionPayload } from '@/lib/auth';
import {
  ROLES_SYSTEME_MARCHAND,
  libellePermissionMarchand,
  permissionsDuRole,
} from '@/lib/permissions-marchand';
import type { Marchand } from '@/app/generated/prisma/client';

// § Équipe & accès (/marchand/equipe) — la logique serveur partagée par les
// routes /api/marchands/equipe/**.
//
// Le proxy a déjà vérifié le droit d'ouvrir la route (`equipe.voir` pour lire,
// `equipe.gerer` pour écrire, cf. API_MARCHAND). Ce module ajoute ce que la
// table ne peut pas exprimer : QUI est visé. Trois règles, appliquées à tout
// geste d'un membre délégué (le titulaire y échappe par construction, puisqu'il
// détient le catalogue entier) :
//
//  1. PAS D'ESCALADE — on n'accorde pas un droit qu'on n'a pas : ni en
//     attribuant un rôle, ni en créant ou modifiant un rôle.
//  2. PAS DE PRISE SUR PLUS FORT QUE SOI — on ne suspend, ne modifie ni ne
//     retire un membre dont le rôle porte des droits qu'on n'a pas.
//  3. PAS DE PRISE SUR SOI — on ne change ni son propre rôle, ni son propre
//     statut : ce serait le moyen le plus court de contourner 1 et 2, et de se
//     retirer l'accès par mégarde.
//
// Le titulaire n'est jamais une cible : il n'est pas un MarchandMembre, et
// aucune route n'accepte son identifiant.

export interface ContexteEquipe {
  marchand: Marchand;
  estTitulaire: boolean;
  utilisateurId: string;
  permissions: string[];
}

export async function contexteEquipe(session: SessionPayload): Promise<ContexteEquipe> {
  const direct = await prisma.marchand.findUnique({ where: { utilisateurId: session.sub } });
  if (direct) {
    return { marchand: direct, estTitulaire: true, utilisateurId: session.sub, permissions: session.permissions };
  }
  const membre = await prisma.marchandMembre.findUnique({
    where: { utilisateurId: session.sub },
    include: { marchand: true },
  });
  if (!membre) throw new ApiError(403, 'Profil marchand introuvable');
  return {
    marchand: membre.marchand,
    estTitulaire: false,
    utilisateurId: session.sub,
    permissions: session.permissions,
  };
}

// Crée les rôles prédéfinis qui manquent à la boutique, et remet leurs
// permissions stockées au niveau du code (elles n'y sont qu'à titre
// informatif : permissionsDuRole lit le code pour un rôle prédéfini). Appelée
// à chaque lecture de l'écran : idempotente, et quasi gratuite une fois les
// rôles en place.
//
// Collision de nom : si la boutique a déjà un rôle personnalisé nommé
// « Comptable », le prédéfini prend le suffixe « (modèle) » plutôt que
// d'échouer sur l'unicité (marchandId, nom).
export async function assurerRolesSysteme(marchandId: string): Promise<void> {
  const existants = await prisma.roleMarchand.findMany({
    where: { marchandId },
    select: { id: true, cle: true, nom: true, permissions: true },
  });
  const parCle = new Map(existants.filter((r) => r.cle).map((r) => [r.cle as string, r]));
  const noms = new Set(existants.map((r) => r.nom.toLowerCase()));

  for (const def of ROLES_SYSTEME_MARCHAND) {
    const present = parCle.get(def.cle);
    if (present) {
      const aJour =
        present.permissions.length === def.permissions.length &&
        present.permissions.every((p, i) => p === def.permissions[i]);
      if (!aJour) {
        await prisma.roleMarchand.update({ where: { id: present.id }, data: { permissions: def.permissions } });
      }
      continue;
    }
    const nom = noms.has(def.nom.toLowerCase()) ? `${def.nom} (modèle)` : def.nom;
    await prisma.roleMarchand.upsert({
      where: { marchandId_cle: { marchandId, cle: def.cle } },
      create: { marchandId, cle: def.cle, nom, description: def.description, permissions: def.permissions },
      update: {},
    });
    noms.add(nom.toLowerCase());
  }
}

export function contientTout(detenues: string[], demandees: string[]): boolean {
  const set = new Set(detenues);
  return demandees.every((p) => set.has(p));
}

// Règle 1 : les permissions qu'on s'apprête à accorder, confrontées aux siennes.
export function exigerSansEscalade(ctx: ContexteEquipe, accordees: string[]): void {
  if (ctx.estTitulaire) return;
  const manquantes = accordees.filter((p) => !ctx.permissions.includes(p));
  if (manquantes.length > 0) {
    throw new ApiError(
      403,
      `Vous ne pouvez pas accorder des droits que vous ne détenez pas : ${manquantes
        .map(libellePermissionMarchand)
        .join(', ')}`
    );
  }
}

// Règles 2 et 3, pour un geste sur un membre existant.
export function exigerPriseSurMembre(
  ctx: ContexteEquipe,
  cible: { utilisateurId: string; role: { cle: string | null; permissions: string[] } }
): void {
  if (cible.utilisateurId === ctx.utilisateurId) {
    throw new ApiError(403, 'Vous ne pouvez pas modifier votre propre accès : demandez-le à un autre responsable');
  }
  if (ctx.estTitulaire) return;
  if (!contientTout(ctx.permissions, permissionsDuRole(cible.role))) {
    throw new ApiError(403, 'Ce membre dispose de droits que vous n’avez pas : seul le titulaire peut le modifier');
  }
}

export async function roleDeLaBoutique(marchandId: string, roleId: unknown) {
  if (typeof roleId !== 'string' || !roleId) throw new ApiError(400, 'Choisissez un rôle');
  const role = await prisma.roleMarchand.findUnique({ where: { id: roleId } });
  if (!role || role.marchandId !== marchandId) throw new ApiError(400, 'Rôle introuvable');
  return role;
}

// Un membre de CETTE boutique, avec son rôle — 404 pour tout autre
// identifiant, y compris un membre d'une autre boutique (ne rien révéler).
export async function membreDeLaBoutique(ctx: ContexteEquipe, id: string) {
  const membre = await prisma.marchandMembre.findUnique({
    where: { id },
    include: { role: true, utilisateur: { select: { id: true, nomComplet: true, email: true, actif: true } } },
  });
  if (!membre || membre.marchandId !== ctx.marchand.id) throw new ApiError(404, 'Membre introuvable');
  return membre;
}

export function lireNomRole(value: unknown): string {
  const nom = typeof value === 'string' ? value.trim() : '';
  if (!nom) throw new ApiError(400, 'Le nom du rôle est requis');
  if (nom.length > 60) throw new ApiError(400, 'Nom trop long (60 caractères maximum)');
  return nom;
}

export function lireDescriptionRole(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = value.trim();
  if (d.length > 240) throw new ApiError(400, 'Description trop longue (240 caractères maximum)');
  return d || null;
}

// Date d'expiration d'accès : `null`/vide = sans limite ; sinon une date
// future. Acceptée au format AAAA-MM-JJ (champ date) — l'accès court alors
// jusqu'à la FIN de ce jour-là, heure du Maroc, ce qu'attend quelqu'un qui
// écrit « jusqu'au 30 ».
export function lireExpiration(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, "Date d'expiration invalide");
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59+01:00` : value;
  const d = new Date(jour);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "Date d'expiration invalide");
  if (d <= new Date()) throw new ApiError(400, "La date d'expiration doit être dans le futur");
  return d;
}

export function lirePoste(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (t.length > 80) throw new ApiError(400, 'Intitulé de poste trop long (80 caractères maximum)');
  return t || null;
}

// --- Journal ---------------------------------------------------------------

export type ActionJournalEquipe =
  | 'membre_ajoute'
  | 'membre_invite'
  | 'invitation_renvoyee'
  | 'membre_modifie'
  | 'role_change'
  | 'membre_suspendu'
  | 'membre_reactive'
  | 'membre_retire'
  | 'mot_de_passe_reinitialise'
  | 'role_cree'
  | 'role_modifie'
  | 'role_supprime';

export async function journaliser(
  ctx: ContexteEquipe,
  action: ActionJournalEquipe,
  cible: string | null,
  details?: string | null
): Promise<void> {
  // Le journal ne doit jamais faire échouer le geste qu'il décrit : ce geste
  // est déjà en base quand on l'écrit.
  try {
    await prisma.journalEquipeMarchand.create({
      data: { marchandId: ctx.marchand.id, auteurId: ctx.utilisateurId, action, cible, details: details ?? null },
    });
  } catch (erreur) {
    console.error('[equipe-marchand] journal non écrit', erreur);
  }
}

// --- Sérialisation ---------------------------------------------------------

export const SELECT_MEMBRE = {
  id: true,
  dateAjout: true,
  poste: true,
  modeAjout: true,
  invitationAccepteeLe: true,
  accesExpireLe: true,
  roleId: true,
  ajouteParU: { select: { nomComplet: true } },
  utilisateur: {
    select: {
      id: true,
      nomComplet: true,
      email: true,
      actif: true,
      derniereConnexion: true,
      resetTokenExpire: true,
    },
  },
} as const;

export type StatutMembre = 'actif' | 'invitation' | 'invitation_expiree' | 'suspendu' | 'expire';

type MembreBrut = {
  id: string;
  dateAjout: Date;
  poste: string | null;
  modeAjout: 'manuel' | 'invitation';
  invitationAccepteeLe: Date | null;
  accesExpireLe: Date | null;
  roleId: string;
  ajouteParU: { nomComplet: string } | null;
  utilisateur: {
    id: string;
    nomComplet: string;
    email: string | null;
    actif: boolean;
    derniereConnexion: Date | null;
    resetTokenExpire: Date | null;
  };
};

// Statut lisible, dans l'ordre de ce qui empêche réellement de se connecter.
export function statutMembre(m: MembreBrut, maintenant = new Date()): StatutMembre {
  if (!m.utilisateur.actif) return 'suspendu';
  if (m.accesExpireLe && m.accesExpireLe <= maintenant) return 'expire';
  if (m.modeAjout === 'invitation' && !m.invitationAccepteeLe) {
    return m.utilisateur.resetTokenExpire && m.utilisateur.resetTokenExpire > maintenant
      ? 'invitation'
      : 'invitation_expiree';
  }
  return 'actif';
}

export function serialiserMembre(m: MembreBrut) {
  return {
    id: m.id,
    utilisateurId: m.utilisateur.id,
    nomComplet: m.utilisateur.nomComplet,
    email: m.utilisateur.email,
    poste: m.poste,
    roleId: m.roleId,
    modeAjout: m.modeAjout,
    statut: statutMembre(m),
    dateAjout: m.dateAjout,
    derniereConnexion: m.utilisateur.derniereConnexion,
    accesExpireLe: m.accesExpireLe,
    invitationExpireLe:
      m.modeAjout === 'invitation' && !m.invitationAccepteeLe ? m.utilisateur.resetTokenExpire : null,
    ajoutePar: m.ajouteParU?.nomComplet ?? null,
  };
}

export function serialiserRole(r: {
  id: string;
  nom: string;
  description: string | null;
  cle: string | null;
  permissions: string[];
  dateCreation: Date;
  _count?: { membres: number };
}) {
  return {
    id: r.id,
    nom: r.nom,
    description: r.description,
    systeme: !!r.cle,
    cle: r.cle,
    permissions: permissionsDuRole(r),
    nbMembres: r._count?.membres ?? 0,
    dateCreation: r.dateCreation,
  };
}
