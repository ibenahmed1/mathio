import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { STATUTS_TERMINAUX } from '@/lib/statuts';

// § Stock commun (12/10/2026), vu par le vendeur : les produits du stock
// commun d'une plateforme qu'il vend — ceux qu'il a mis dans ses colis — avec
// SES ventes (en cours, livrées, retournées) et le stock commun disponible.
// Ce stock ne lui appartient pas : il le partage avec les autres vendeurs de
// la plateforme, sans réservation.
export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const lignes = await prisma.ligneColis.findMany({
      where: { provenance: 'stock_plateforme', produitId: { not: null }, commande: { marchandId: marchand.id } },
      select: { produitId: true, varianteId: true, quantite: true, commande: { select: { statut: true } } },
    });

    // Ventes par unité de stock (produit simple, ou variante).
    const ventes = new Map<string, { enCours: number; livrees: number; retournees: number }>();
    for (const l of lignes) {
      const cle = `${l.produitId}|${l.varianteId ?? ''}`;
      const v = ventes.get(cle) ?? { enCours: 0, livrees: 0, retournees: 0 };
      const statut = l.commande.statut;
      if (statut === 'livre') v.livrees += l.quantite;
      else if (statut === 'retourne') v.retournees += l.quantite;
      else if (!STATUTS_TERMINAUX.includes(statut)) v.enCours += l.quantite;
      ventes.set(cle, v);
    }

    const produits = await prisma.produit.findMany({
      where: { id: { in: [...new Set(lignes.map((l) => l.produitId!))] }, plateformeId: { not: null } },
      orderBy: { nom: 'asc' },
      select: {
        id: true,
        nom: true,
        reference: true,
        photoUrl: true,
        variantesActivees: true,
        quantiteRecue: true,
        quantiteEnCours: true,
        plateforme: { select: { nom: true } },
        variantes: {
          orderBy: { reference: 'asc' },
          select: { id: true, nom: true, reference: true, quantiteRecue: true, quantiteEnCours: true, photoUrl: true },
        },
      },
    });

    const unites = produits.flatMap((p) => {
      const base = { produitId: p.id, photoUrl: p.photoUrl, plateforme: p.plateforme?.nom ?? '' };
      const brutes = p.variantesActivees
        ? p.variantes.map((v) => ({
            ...base,
            photoUrl: v.photoUrl ?? p.photoUrl,
            varianteId: v.id,
            nom: `${p.nom} — ${v.nom}`,
            sku: v.reference,
            disponible: v.quantiteRecue,
            annonce: v.quantiteEnCours,
          }))
        : [{ ...base, varianteId: null, nom: p.nom, sku: p.reference, disponible: p.quantiteRecue, annonce: p.quantiteEnCours }];
      return brutes
        .filter((u) => ventes.has(`${u.produitId}|${u.varianteId ?? ''}`))
        .map((u) => ({ ...u, ...ventes.get(`${u.produitId}|${u.varianteId ?? ''}`)! }));
    });

    return NextResponse.json({ data: unites });
  } catch (error) {
    return jsonError(error);
  }
}
