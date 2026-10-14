import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { ApiError } from '@/lib/api-utils';
import { destinatairesBoutique, notifier } from '@/lib/notifications';
import type { StatutReclamation } from '@/app/generated/prisma/enums';

// § Réclamations — fil des réponses (14/10/2026). Une réponse enregistrée
// reste telle quelle ; les suivantes s'ajoutent, jusqu'à la fermeture de la
// réclamation (résolue ou rejetée), après quoi on ne répond plus.

export const STATUTS_RECLAMATION_FERMEE: StatutReclamation[] = ['resolue', 'rejetee'];

export const INCLUDE_RECLAMATION = {
  marchand: { select: { nomBoutique: true } },
  commande: { select: { id: true, codeSuivi: true } },
  utilisateur: { select: { nomComplet: true } },
  reponses: { orderBy: { dateCreation: 'asc' }, include: { auteur: { select: { nomComplet: true } } } },
} satisfies Prisma.ReclamationInclude;

type ReclamationLue = Prisma.ReclamationGetPayload<{ include: typeof INCLUDE_RECLAMATION }>;

// Le marchand lit les réponses, pas qui, parmi nous, les a écrites (aucune
// information interne côté marchand) : elles sont signées « l'équipe ».
export function exposerReclamation(r: ReclamationLue, pourMarchand: boolean) {
  const { reponse: _ancienne, dateReponse: _ancienneDate, ...reste } = r;
  void _ancienne;
  void _ancienneDate;
  return {
    ...reste,
    reponses: r.reponses.map((rep) => ({
      id: rep.id,
      texte: rep.texte,
      dateCreation: rep.dateCreation,
      auteur: pourMarchand ? null : (rep.auteur?.nomComplet ?? null),
    })),
  };
}

export async function ajouterReponse(reclamationId: string, auteurId: string, texteBrut: unknown) {
  const texte = typeof texteBrut === 'string' ? texteBrut.trim() : '';
  if (!texte) throw new ApiError(400, 'La réponse est vide');

  const reclamation = await prisma.reclamation.findUnique({
    where: { id: reclamationId },
    select: { id: true, statut: true, sujet: true, marchandId: true, utilisateurId: true },
  });
  if (!reclamation) throw new ApiError(404, 'Réclamation introuvable');
  if (STATUTS_RECLAMATION_FERMEE.includes(reclamation.statut)) {
    throw new ApiError(409, 'Cette réclamation est fermée : on n’y répond plus. Rouvrez-la pour répondre.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.reponseReclamation.create({ data: { reclamationId, auteurId, texte } });
    // Une première réponse fait passer la réclamation « en cours ».
    await tx.reclamation.updateMany({ where: { id: reclamationId, statut: 'ouverte' }, data: { statut: 'en_cours' } });
  });

  // § Notifications : chaque réponse écrite. Son auteur la reçoit en plus de
  // ceux qui suivent les réclamations de la boutique — sauf s'il n'est pas
  // marchand (réclamation ouverte d'office par un agent).
  const destinataires = await destinatairesBoutique(reclamation.marchandId, 'reclamations.voir');
  const auteur = await prisma.utilisateur.findUnique({ where: { id: reclamation.utilisateurId }, select: { role: true } });
  if (auteur?.role === 'marchand') destinataires.push(reclamation.utilisateurId);
  await notifier(
    destinataires,
    {
      type: 'reclamation.repondue',
      titre: `Réponse à votre réclamation : ${reclamation.sujet}`,
      corps: texte.length > 140 ? `${texte.slice(0, 140)}…` : texte,
      lien: '/marchand/reclamations',
    },
    { sauf: auteurId }
  );
}
