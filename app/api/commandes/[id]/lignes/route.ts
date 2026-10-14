import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Contenu d'un colis (§ LigneColis) pour la fiche « Information du colis » :
// chaque produit, sa quantité, et d'où sort son stock — celui du vendeur, ou
// le stock commun d'une plateforme partenaire (§ stock commun, 12/10/2026).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const commande = await prisma.commande.findUnique({
      where: { id },
      select: {
        enAttenteStock: true,
        lignes: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            sku: true,
            libelle: true,
            quantite: true,
            provenance: true,
            produit: { select: { photoUrl: true, plateforme: { select: { nom: true } } } },
            variante: { select: { photoUrl: true } },
          },
        },
      },
    });
    if (!commande) throw new ApiError(404, 'Colis introuvable');

    return NextResponse.json({
      enAttenteStock: commande.enAttenteStock,
      lignes: commande.lignes.map(({ produit, variante, ...l }) => ({
        ...l,
        // La photo de la variante quand elle en a une, sinon celle du produit.
        photoUrl: variante?.photoUrl ?? produit?.photoUrl ?? null,
        plateforme: produit?.plateforme?.nom ?? null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
