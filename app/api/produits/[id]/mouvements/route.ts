import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const LIMITE = 500;

// Journal des mouvements de stock d'un produit (§ MouvementStock), du plus
// récent au plus ancien, et — pour un produit du stock commun d'une
// plateforme — ce que chaque vendeur en a consommé : sorties pour ses colis,
// moins ses retours.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const produit = await prisma.produit.findUnique({ where: { id }, select: { plateformeId: true } });
    if (!produit) throw new ApiError(404, 'Produit introuvable');

    const [mouvements, total, consommation] = await Promise.all([
      prisma.mouvementStock.findMany({
        where: { produitId: id },
        orderBy: [{ horodatage: 'desc' }, { id: 'desc' }],
        take: LIMITE,
        select: {
          id: true,
          horodatage: true,
          type: true,
          quantite: true,
          motif: true,
          variante: { select: { nom: true } },
          commande: { select: { id: true, codeSuivi: true } },
          marchand: { select: { nomBoutique: true } },
          envoi: { select: { reference: true } },
          utilisateur: { select: { nomComplet: true } },
        },
      }),
      prisma.mouvementStock.count({ where: { produitId: id } }),
      produit.plateformeId
        ? prisma.mouvementStock.groupBy({
            by: ['marchandId'],
            where: { produitId: id, type: { in: ['sortie_colis', 'retour_colis'] }, marchandId: { not: null } },
            _sum: { quantite: true },
          })
        : Promise.resolve([]),
    ]);

    const boutiques = await prisma.marchand.findMany({
      where: { id: { in: consommation.map((c) => c.marchandId!) } },
      select: { id: true, nomBoutique: true },
    });
    const nomDe = new Map(boutiques.map((b) => [b.id, b.nomBoutique]));
    const parVendeur = consommation
      .map((c) => ({ marchandId: c.marchandId!, nomBoutique: nomDe.get(c.marchandId!) ?? '—', consomme: -(c._sum.quantite ?? 0) }))
      .filter((c) => c.consomme !== 0)
      .sort((a, b) => b.consomme - a.consomme);

    return NextResponse.json({ mouvements, total, tronque: total > LIMITE, consommation: parVendeur });
  } catch (error) {
    return jsonError(error);
  }
}
