import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { reliquatReception } from '@/lib/stock-quantites';

// § Clôture de réception (décision produit du 26/08/2026, cf. comments.md § 1).
//
// Le marchand déclare 10 pièces, l'admin n'en valide que 8 : les 2 restantes
// dorment dans `quantiteEnCours` sans que rien ne les en sorte jamais. Cet
// écart n'est pas un bug de comptage, c'est un LITIGE — et un litige qui reste
// dans un compteur d'inventaire n'est opposable à personne.
//
// Cette route le solde explicitement : le reliquat passe à 0, le mouvement est
// tracé nominativement, et une réclamation est ouverte automatiquement contre
// le marchand. Elle atterrit dans /admin/reclamations, où elle sera traitée
// comme n'importe quel autre litige — plutôt que dans un écran d'anomalies
// dédié que personne n'irait consulter.
//
// Volontairement PAS conditionné à statutReception === 'recu', contrairement
// aux routes de réception et de retrait : un colis marchand qui n'est jamais
// arrivé laisse un reliquat sur un produit encore "pas encore reçu", et c'est
// précisément un cas qu'il faut pouvoir solder.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const motif = typeof body?.motif === 'string' && body.motif.trim() ? body.motif.trim() : null;

    const produit = await prisma.produit.findUnique({
      where: { id },
      include: { variantes: true, marchand: { select: { id: true, nomBoutique: true } } },
    });
    if (!produit) throw new ApiError(404, 'Produit introuvable');

    const variantesAvecReliquat = produit.variantes.filter((v) => v.quantiteEnCours > 0);
    const reliquat = reliquatReception(produit);

    if (reliquat <= 0) {
      throw new ApiError(400, 'Aucun reliquat à clôturer sur ce produit');
    }

    // Détail par variante figé AVANT la remise à zéro : c'est la seule chance
    // de dire au marchand QUOI manque, et pas seulement combien.
    const detail = produit.variantesActivees
      ? variantesAvecReliquat.map((v) => `${v.nom} : ${v.quantiteEnCours}`).join(', ')
      : `${produit.nom} : ${reliquat}`;

    await prisma.$transaction(async (tx) => {
      if (produit.variantesActivees) {
        await tx.produitVariante.updateMany({
          where: { produitId: id, quantiteEnCours: { gt: 0 } },
          data: { quantiteEnCours: 0 },
        });
      } else {
        // Garde d'optimistic locking : si une validation de réception est
        // passée entre la lecture et l'écriture, le reliquat a changé et
        // clôturer sur la valeur périmée effacerait une quantité qui vient
        // d'être reçue. Même stratégie que les routes de réception/retrait.
        const resultat = await tx.produit.updateMany({
          where: { id, quantiteEnCours: reliquat },
          data: { quantiteEnCours: 0 },
        });
        if (resultat.count === 0) {
          throw new ApiError(409, 'Le reliquat a changé entre-temps — rechargez la fiche produit');
        }
      }

      await tx.historiqueProduit.create({
        data: {
          produitId: id,
          texte: `Réception clôturée — reliquat de ${reliquat} unité(s) soldé (${detail})${motif ? ` — ${motif}` : ''}`,
          utilisateurId: session.sub,
        },
      });

      await tx.reclamation.create({
        data: {
          marchandId: produit.marchandId,
          utilisateurId: session.sub,
          sujet: `Écart de réception — ${produit.nom} (${produit.reference})`,
          message:
            `Réception clôturée avec un reliquat de ${reliquat} unité(s) non reçue(s) : ${detail}. ` +
            `La quantité déclarée par le marchand n'a jamais été réceptionnée en entrepôt.` +
            (motif ? `\n\nMotif renseigné par l'agent : ${motif}` : ''),
        },
      });
    });

    const produitMisAJour = await prisma.produit.findUnique({
      where: { id },
      include: { variantes: true },
    });
    return NextResponse.json(produitMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
