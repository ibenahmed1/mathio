import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { receptionnerUnite } from '@/lib/stock-reception';
import { servirColisEnAttente } from '@/lib/stock-reservation';

// Réception d'un envoi annoncé par une plateforme : l'entrepôt saisit, ligne
// par ligne, ce qu'il a compté. Corps : { lignes: [{ ligneId, quantite }] }.
// Une ligne ne reçoit jamais plus que ce qu'il en reste à recevoir ; ce qui
// manque reste ouvert jusqu'à un prochain comptage.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const saisies = Array.isArray(body?.lignes) ? (body.lignes as { ligneId?: unknown; quantite?: unknown }[]) : [];
    const demandes = new Map<string, number>();
    for (const s of saisies) {
      const quantite = Math.trunc(Number(s.quantite));
      if (typeof s.ligneId !== 'string' || !Number.isFinite(quantite) || quantite < 0) {
        throw new ApiError(400, 'Chaque ligne attend un ligneId et une quantité positive ou nulle');
      }
      if (quantite > 0) demandes.set(s.ligneId, (demandes.get(s.ligneId) ?? 0) + quantite);
    }
    if (demandes.size === 0) throw new ApiError(400, 'Saisissez au moins une quantité reçue');

    const envoi = await prisma.envoiStock.findUnique({
      where: { id },
      select: {
        reference: true,
        lignes: {
          select: {
            id: true,
            sku: true,
            produitId: true,
            varianteId: true,
            quantiteAnnoncee: true,
            quantiteRecue: true,
            produit: { select: { nom: true, statutReception: true } },
            variante: { select: { nom: true } },
          },
        },
      },
    });
    if (!envoi) throw new ApiError(404, 'Envoi introuvable');

    const lignes = new Map(envoi.lignes.map((l) => [l.id, l]));
    for (const [ligneId, quantite] of demandes) {
      const ligne = lignes.get(ligneId);
      if (!ligne) throw new ApiError(400, 'Ligne étrangère à cet envoi');
      const reste = ligne.quantiteAnnoncee - ligne.quantiteRecue;
      if (quantite > reste) {
        throw new ApiError(400, `${ligne.sku} : ${quantite} saisi(s), il n'en reste que ${reste} à recevoir sur cet envoi`);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const [ligneId, quantite] of demandes) {
        const ligne = lignes.get(ligneId)!;
        // Recevoir un envoi, c'est constater le produit en entrepôt : le
        // verrou de réception s'ouvre de lui-même, et l'historique le dit.
        if (ligne.produit.statutReception !== 'recu') {
          const ouvert = await tx.produit.updateMany({
            where: { id: ligne.produitId, statutReception: { not: 'recu' } },
            data: { statutReception: 'recu' },
          });
          if (ouvert.count > 0) {
            await tx.historiqueProduit.create({
              data: {
                produitId: ligne.produitId,
                texte: `Statut de réception : Pas encore reçu → Reçu (envoi ${envoi.reference})`,
                utilisateurId: session.sub,
              },
            });
          }
        }
        await receptionnerUnite(tx, {
          produitId: ligne.produitId,
          varianteId: ligne.varianteId,
          nom: ligne.variante?.nom ?? ligne.produit.nom,
          quantite,
          utilisateurId: session.sub,
          envoiId: id,
        });
      }
    });

    // Du stock vient d'entrer : les colis qui l'attendaient sont servis.
    await servirColisEnAttente([...new Set([...demandes.keys()].map((l) => lignes.get(l)!.produitId))], session.sub);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
