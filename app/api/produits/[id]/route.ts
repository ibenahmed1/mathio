import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import type { SessionPayload } from '@/lib/auth';
import type { StatutReceptionProduit } from '@/app/generated/prisma/enums';

const STATUTS_RECEPTION_VALIDES: StatutReceptionProduit[] = ['pas_encore_recu', 'recu'];

async function findOwnProduit(id: string, utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  const produit = await prisma.produit.findUnique({ where: { id } });
  if (!produit || !marchand || produit.marchandId !== marchand.id) {
    throw new ApiError(404, 'Produit introuvable');
  }
  return produit;
}

async function findProduitAccessible(id: string, session: SessionPayload) {
  if (session.role === 'admin') {
    const produit = await prisma.produit.findUnique({ where: { id } });
    if (!produit) throw new ApiError(404, 'Produit introuvable');
    return produit;
  }
  return findOwnProduit(id, session.sub);
}

// Détail d'un produit (page admin "Modifier produit") : inclut variantes et
// historique des mouvements de stock.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand', 'admin']);
    const { id } = await params;
    await findProduitAccessible(id, session);

    const produit = await prisma.produit.findUnique({
      where: { id },
      include: {
        variantes: true,
        historique: { orderBy: { dateCreation: 'desc' } },
        marchand: { select: { nomBoutique: true } },
      },
    });
    return NextResponse.json(produit);
  } catch (error) {
    return jsonError(error);
  }
}

// Édition admin (page "Modifier produit") : nom, note, photo, et
// l'emplacement d'entrepôt quand le produit ne suit pas ses variantes
// individuellement (sinon voir PATCH /api/produits/variantes/[id]).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const produit = await prisma.produit.findUnique({ where: { id } });
    if (!produit) throw new ApiError(404, 'Produit introuvable');

    const body = await request.json();
    const data: {
      nom?: string;
      note?: string | null;
      photoUrl?: string | null;
      rayonnage?: string | null;
      statutReception?: StatutReceptionProduit;
    } = {};

    if (typeof body.nom === 'string' && body.nom.trim()) data.nom = body.nom.trim();
    if ('note' in body) data.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    if ('photoUrl' in body) data.photoUrl = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl : null;
    if ('rayonnage' in body) {
      if (produit.variantesActivees) {
        throw new ApiError(400, 'Ce produit suit ses variantes individuellement — modifiez le rayonnage sur chaque variante');
      }
      data.rayonnage = typeof body.rayonnage === 'string' && body.rayonnage.trim() ? body.rayonnage.trim() : null;
    }
    if ('statutReception' in body) {
      if (!STATUTS_RECEPTION_VALIDES.includes(body.statutReception)) {
        throw new ApiError(400, `statutReception invalide. Valeurs possibles : ${STATUTS_RECEPTION_VALIDES.join(', ')}`);
      }
      data.statutReception = body.statutReception;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ modifiable fourni');
    }

    const updated = await prisma.produit.update({ where: { id }, data, include: { variantes: true } });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;
    await findOwnProduit(id, session.sub);
    await prisma.produit.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
