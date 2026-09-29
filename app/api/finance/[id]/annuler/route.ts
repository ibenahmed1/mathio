import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { TypeTransaction } from '@/app/generated/prisma/enums';
import { LONGUEUR_MAX_TITRE } from '@/lib/finance';

const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

const TYPE_INVERSE: Record<TypeTransaction, TypeTransaction> = {
  revenu: 'depense',
  depense: 'revenu',
};

// Annuler une écriture revient à créer une transaction de compensation
// (Avoir/Correction), de sens inverse et de même montant/catégorie, et à
// marquer l'originale `estAnnulee`. C'est le geste du responsable
// (`comptabilite:write`) : il laisse sa trace DANS le journal. Modifier ou
// supprimer une écriture est un autre geste, réservé à l'admin
// (lib/journal-comptable.ts).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const motif = typeof body.motif === 'string' && body.motif.trim() ? body.motif.trim() : null;

    // `omit` sur le justificatif : l'annulation n'a besoin que du montant, du
    // type et de la catégorie de l'écriture d'origine. Sans ce retrait, chaque
    // annulation ferait remonter la photo en base64 jusqu'à Node pour ne rien
    // en faire (§ Transaction.preuveUrl).
    const original = await prisma.transaction.findUnique({
      where: { id },
      omit: { preuveUrl: true },
      include: { annulation: { select: { id: true } } },
    });
    if (!original) {
      throw new ApiError(404, 'Transaction introuvable');
    }
    if (original.supprimeLe) {
      throw new ApiError(409, "Cette transaction est supprimée : restaurez-la avant de la neutraliser");
    }
    if (original.transactionOrigineId) {
      throw new ApiError(400, 'Une neutralisation ne se neutralise pas : supprimez-la pour la défaire');
    }
    if (original.estAnnulee) {
      throw new ApiError(400, 'Cette transaction est déjà neutralisée');
    }
    // Compensation supprimée depuis : la clé `transactionOrigineId` est
    // unique, une seconde compensation serait refusée par la base. Restaurer
    // l'ancienne rend le même service et garde une seule trace.
    if (original.annulation) {
      throw new ApiError(409, "Sa neutralisation est dans la corbeille : restaurez-la plutôt que d'en créer une seconde");
    }

    const [, annulation] = await prisma.$transaction([
      prisma.transaction.update({ where: { id: original.id }, data: { estAnnulee: true } }),
      prisma.transaction.create({
        data: {
          montant: original.montant,
          type: TYPE_INVERSE[original.type],
          titre: `Neutralisation — ${original.titre}`.slice(0, LONGUEUR_MAX_TITRE),
          categorieId: original.categorieId,
          dateEffet: new Date(),
          description: motif ? `Neutralisation de la transaction ${original.id} — ${motif}` : `Neutralisation de la transaction ${original.id}`,
          auteurId: session.sub,
          // Pas de `preuveUrl` ici, volontairement : le justificatif
          // photographié appartient à l'écriture d'origine, qui reste en base.
          // Le recopier sur la compensation ferait croire à un second
          // document, et le même base64 pèserait deux fois dans les
          // sauvegardes. Le motif d'annulation suffit à faire le lien.
          transactionOrigineId: original.id,
        },
        select: { id: true },
      }),
    ]);

    // L'écran recharge le journal après une annulation : l'identifiant suffit,
    // et aucun Decimal ne part dans la réponse.
    return NextResponse.json({ id: annulation.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
