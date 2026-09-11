import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  ENTETE_DEPRECIATION,
  analyserCle,
  depreciationImminente,
  extraireCle,
  secretCorrespond,
} from '@/lib/plateforme-cles';
import type { EnvironnementApi } from '@/app/generated/prisma/enums';

// Authentification MACHINE des plateformes partenaires — pendant exact de
// `requireUser()` (lib/api-utils.ts) pour le canal entrant.
//
// Pourquoi ici et pas dans le proxy, alors que les sessions cookie y sont
// vérifiées : le proxy tourne en runtime edge, et vérifier une clé demande
// une lecture Prisma (la clé, la plateforme, le quota). Le proxy se contente
// donc de garantir que `/api/v1/**` n'est atteignable QUE depuis l'hôte API,
// et réciproquement. Le commentaire de `requireUser` dit déjà le reste : on
// revérifie dans chaque handler pour qu'il reste sûr indépendamment de la
// configuration de routage.

// --- Erreurs ----------------------------------------------------------------
//
// Une erreur d'API machine a besoin d'un CODE stable en plus du message : le
// message est écrit pour un humain qui lit un journal, le code est ce sur quoi
// l'intégrateur branche son `if`. Changer une formulation ne doit pas casser
// son code.
export class ErreurPlateforme extends ApiError {
  code: string;

  constructor(status: number, code: string, message: string) {
    super(status, message);
    this.code = code;
  }
}

export function jsonErreurPlateforme(error: unknown): NextResponse {
  if (error instanceof ErreurPlateforme) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ code: 'requete_invalide', message: error.message }, { status: error.status });
  }
  // Même règle que `jsonError` : rien de l'interne ne sort vers l'appelant.
  console.error(error);
  return NextResponse.json({ code: 'erreur_interne', message: 'Erreur interne du serveur' }, { status: 500 });
}

// --- Contexte d'un appel authentifié ----------------------------------------

export interface ContextePlateforme {
  plateformeId: string;
  plateformeCode: string;
  cleId: string;
  scopes: string[];
  environnement: EnvironnementApi;
  /**
   * Compte de service qui signera les écritures de cet appel (auteur des
   * entrées d'historique). Voir PlateformePartenaire.utilisateurTechnique.
   */
  utilisateurTechniqueId: string;
  /** Renseigné pendant la fenêtre de grâce précédant l'expiration de la clé. */
  depreciationLe: Date | null;
  adresseIp: string | null;
}

// Message unique pour TOUS les échecs d'identification de la clé (absente,
// mal formée, inconnue, secret faux). Distinguer ces cas dirait à qui sonde
// si un préfixe existe — même raisonnement que INVALID_CREDENTIALS_MESSAGE
// côté login. Révocation et expiration, elles, sont distinguées : elles ne
// concernent qu'un porteur qui S'EST DÉJÀ authentifié une fois, et le taire
// lui ferait chercher la panne au mauvais endroit.
const CLE_INVALIDE = 'Clé d’API absente ou invalide';

// Plafond par IP, appliqué AVANT toute lecture de base.
//
// Le quota par clé (plus bas) ne protège que le trafic AUTHENTIFIÉ : une clé
// inconnue n'a pas de quota, donc rien ne bornait le nombre de tentatives — ni
// la charge qu'elles imposent, chacune coûtant un accès à l'index des
// préfixes. Les trois endpoints publics humains (login, mot de passe oublié,
// inscription) sont limités par IP depuis toujours ; cette surface-ci ne
// l'était pas.
//
// Le plafond est délibérément HAUT : il ne remplace pas le quota par clé, il
// borne seulement l'abus. Une intégration légitime, bornée par son propre
// quota, ne l'atteint jamais.
const PLAFOND_IP = { max: 2000, fenetreMs: 60_000 };

export async function requirePlateforme(
  request: Request,
  scopesRequis: string[]
): Promise<ContextePlateforme> {
  const ip = getClientIp(request) ?? 'inconnue';
  const plafond = await checkRateLimit(`plateforme-ip:${ip}`, PLAFOND_IP.max, PLAFOND_IP.fenetreMs);
  if (!plafond.allowed) {
    throw new ErreurPlateforme(
      429,
      'quota_depasse',
      `Trop de requêtes depuis cette adresse. Réessayez dans ${plafond.retryAfterSeconds} s`
    );
  }

  const brut = extraireCle(request.headers);
  if (!brut) throw new ErreurPlateforme(401, 'cle_absente', CLE_INVALIDE);

  const analysee = analyserCle(brut);
  if (!analysee) throw new ErreurPlateforme(401, 'cle_invalide', CLE_INVALIDE);

  const cle = await prisma.cleApiPlateforme.findUnique({
    where: { prefixe: analysee.prefixe },
    include: { plateforme: { select: { id: true, code: true, actif: true, utilisateurTechniqueId: true } } },
  });
  if (!cle) throw new ErreurPlateforme(401, 'cle_invalide', CLE_INVALIDE);

  if (!secretCorrespond(analysee.secret, cle.secretHash)) {
    throw new ErreurPlateforme(401, 'cle_invalide', CLE_INVALIDE);
  }

  // Refus DUR, sans période de grâce : une clé révoquée l'a été parce qu'elle
  // a fuité ou que la relation s'est arrêtée.
  if (cle.revoqueeLe) {
    throw new ErreurPlateforme(401, 'cle_revoquee', 'Cette clé d’API a été révoquée');
  }

  const maintenant = new Date();
  if (cle.expireLe && cle.expireLe <= maintenant) {
    throw new ErreurPlateforme(401, 'cle_expiree', 'Cette clé d’API a expiré');
  }

  if (!cle.plateforme.actif) {
    throw new ErreurPlateforme(403, 'plateforme_desactivee', 'Cette intégration est désactivée');
  }

  const manquants = scopesRequis.filter((s) => !cle.scopes.includes(s));
  if (manquants.length > 0) {
    throw new ErreurPlateforme(
      403,
      'scope_manquant',
      `Cette clé n’a pas le périmètre requis : ${manquants.join(', ')}`
    );
  }

  // Quota par clé et par minute, avec le compteur atomique déjà utilisé pour
  // les endpoints publics (lib/rate-limit.ts) : la limite est stockée sur la
  // clé, donc brider une intégration qui s'emballe ne demande pas un
  // déploiement.
  const quota = await checkRateLimit(`plateforme:${cle.id}`, cle.quotaParMinute, 60_000);
  if (!quota.allowed) {
    throw new ErreurPlateforme(
      429,
      'quota_depasse',
      `Quota dépassé. Réessayez dans ${quota.retryAfterSeconds} s`
    );
  }

  // Ces deux compteurs restent exploitables après une révocation (quand la
  // clé fuitée a-t-elle servi, et combien de fois) : c'est leur seule raison
  // d'être, et c'est pourquoi une ligne de clé n'est jamais supprimée.
  await prisma.cleApiPlateforme.update({
    where: { id: cle.id },
    data: { derniereUtilisationLe: maintenant, nbAppels: { increment: 1 } },
  });

  return {
    plateformeId: cle.plateforme.id,
    plateformeCode: cle.plateforme.code,
    cleId: cle.id,
    scopes: cle.scopes,
    environnement: cle.environnement,
    utilisateurTechniqueId: cle.plateforme.utilisateurTechniqueId,
    depreciationLe: depreciationImminente(cle.expireLe, maintenant) ? cle.expireLe : null,
    adresseIp: ip === 'inconnue' ? null : ip,
  };
}

// Lecture du corps JSON. `request.json()` lève une SyntaxError sur un corps
// malformé, qui deviendrait un 500 — c'est-à-dire « le problème est chez
// nous » — alors que c'est le client qui a mal formé sa requête. Un
// intégrateur qui débogue a besoin de cette distinction.
export async function lireCorpsJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ErreurPlateforme(400, 'json_invalide', 'Le corps de la requête n’est pas du JSON valide');
  }
}

// Exige AU MOINS UN scope parmi plusieurs, là où `requirePlateforme` les exige
// tous. Sert quand deux scopes ouvrent le même endpoint avec des effets
// différents — `marchands:creation` et `marchands:creation_validee` mènent
// tous deux à POST /v1/marchands, l'un laissant le compte en attente,
// l'autre l'activant.
export function exigeUnScopeParmi(contexte: ContextePlateforme, candidats: string[]): string {
  const detenu = candidats.find((s) => contexte.scopes.includes(s));
  if (!detenu) {
    throw new ErreurPlateforme(
      403,
      'scope_manquant',
      `Cette clé n’a aucun des périmètres requis : ${candidats.join(', ')}`
    );
  }
  return detenu;
}

// Pose l'en-tête de dépréciation quand la clé utilisée arrive à échéance. À
// appliquer sur les réponses de SUCCÈS : c'est là que le partenaire regarde
// le moins, et c'est justement pourquoi l'avertissement doit y être plutôt
// que dans une erreur qu'il ne verra qu'une fois la coupure survenue.
export function avecEntetesPlateforme(
  reponse: NextResponse,
  contexte: ContextePlateforme
): NextResponse {
  if (contexte.depreciationLe) {
    reponse.headers.set(ENTETE_DEPRECIATION, contexte.depreciationLe.toISOString());
  }
  return reponse;
}

// --- Journal des appels reçus -----------------------------------------------

export interface AppelAJournaliser {
  plateformeId: string;
  cleId?: string | null;
  methode: string;
  chemin: string;
  statut: number;
  debutMs: number;
  adresseIp?: string | null;
  reference?: string | null;
  erreur?: string | null;
}

// Écriture volontairement TOLÉRANTE à l'échec : un journal qui tombe ne doit
// jamais transformer une ingestion réussie en erreur pour le partenaire. On
// perd une ligne d'observabilité, pas un colis.
export async function journaliserAppel(appel: AppelAJournaliser): Promise<void> {
  try {
    await prisma.journalAppelApi.create({
      data: {
        plateformeId: appel.plateformeId,
        cleId: appel.cleId ?? null,
        methode: appel.methode,
        chemin: appel.chemin,
        statut: appel.statut,
        dureeMs: Math.round(performance.now() - appel.debutMs),
        adresseIp: appel.adresseIp ?? null,
        reference: appel.reference ?? null,
        erreur: appel.erreur ?? null,
      },
    });
  } catch (error) {
    console.error('Journalisation de l’appel plateforme impossible', error);
  }
}
