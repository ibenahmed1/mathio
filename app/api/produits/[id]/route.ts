import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import type { SessionPayload } from '@/lib/auth';
import { quantiteRecueTotale } from '@/lib/stock-quantites';
import type { StatutReceptionProduit } from '@/app/generated/prisma/enums';

const STATUTS_RECEPTION_VALIDES: StatutReceptionProduit[] = ['pas_encore_recu', 'recu'];

const LIBELLES_RECEPTION: Record<StatutReceptionProduit, string> = {
  pas_encore_recu: 'Pas encore reçu',
  recu: 'Reçu',
};

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
        historique: {
          orderBy: { dateCreation: 'desc' },
          include: { utilisateur: { select: { nomComplet: true } } },
        },
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
    const session = await requireUser(['admin']);
    const { id } = await params;
    const produit = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
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
      // § Retour arrière du statut de réception (décision produit du 26/08/2026).
      //
      // Repasser un produit sur "pas encore reçu" alors que des quantités ont
      // déjà été validées le fait disparaître des écrans de préparation, alors
      // qu'il est physiquement sur l'étagère. On ne l'INTERDIT pas — corriger
      // une erreur de saisie doit rester possible — mais l'appelant doit le
      // demander explicitement, et le mouvement laisse une trace nominative
      // dans l'historique du produit (ci-dessous).
      //
      // 409 et non 400 : la requête est bien formée, c'est l'état actuel du
      // produit qui s'y oppose. L'écran distingue les deux.
      const dejaValide = quantiteRecueTotale(produit);
      if (
        body.statutReception === 'pas_encore_recu' &&
        produit.statutReception !== 'pas_encore_recu' &&
        dejaValide > 0 &&
        body.confirmerRetourArriere !== true
      ) {
        throw new ApiError(
          409,
          `${dejaValide} unité(s) ont déjà été validées en entrepôt pour ce produit. Confirmez explicitement le retour arrière pour continuer.`
        );
      }
      data.statutReception = body.statutReception;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ modifiable fourni');
    }

    const updated = await prisma.produit.update({ where: { id }, data, include: { variantes: true } });

    // Le statut de réception est le VERROU qui ouvre et ferme la saisie des
    // quantités : c'est le mouvement le plus structurant de la fiche produit,
    // et le seul champ de cette route dont l'historique doit garder trace.
    // Les deux sens sont tracés, pas seulement le retour arrière — un
    // historique qui ne raconte que les anomalies ne se relit pas.
    if (data.statutReception && data.statutReception !== produit.statutReception) {
      const motif = typeof body.motif === 'string' && body.motif.trim() ? ` — ${body.motif.trim()}` : '';
      const dejaValide = quantiteRecueTotale(produit);
      const rappel =
        data.statutReception === 'pas_encore_recu' && dejaValide > 0
          ? ` (${dejaValide} unité(s) déjà validée(s) en entrepôt)`
          : '';
      await prisma.historiqueProduit.create({
        data: {
          produitId: id,
          texte: `Statut de réception : ${LIBELLES_RECEPTION[produit.statutReception]} → ${LIBELLES_RECEPTION[data.statutReception]}${rappel}${motif}`,
          utilisateurId: session.sub,
        },
      });
    }

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
