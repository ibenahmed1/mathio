import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validerReceptionProduit } from '@/lib/stock-reception';
import { servirColisEnAttente } from '@/lib/stock-reservation';

// § Validation groupée de la réception (14/10/2026) : plus de 150 produits
// arrivés d'un coup en prod. Pour chaque produit demandé : statut « Reçu »,
// puis TOUT le déclaré passe en reçu — exactement ce que l'admin ferait à la
// main sur chaque fiche, par les mêmes chemins (historique, journal des
// mouvements, envois servis). Les quantités restent corrigibles ensuite
// depuis la fiche (retrait).
//
// Une transaction PAR produit : un produit modifié entre-temps ne bloque pas
// les autres, il est rendu dans `erreurs`. Les produits du bac à sable des
// plateformes sont ignorés : ce n'est pas de la marchandise réelle.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json().catch(() => ({}));
    const ids: unknown = body?.produitIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      throw new ApiError(400, 'produitIds doit être une liste non vide');
    }

    const produits = await prisma.produit.findMany({
      // NULL (produit de marchand) explicitement gardé : en SQL, « <> 'test' »
      // seul écarterait aussi les produits sans plateforme.
      where: { id: { in: ids as string[] }, OR: [{ environnementPlateforme: null }, { environnementPlateforme: 'live' }] },
      select: { id: true, nom: true },
    });

    const valides: string[] = [];
    const erreurs: { produitId: string; nom: string; message: string }[] = [];
    let unites = 0;
    for (const produit of produits) {
      try {
        unites += await validerReceptionProduit(produit.id, session.sub);
        valides.push(produit.id);
      } catch (err) {
        erreurs.push({ produitId: produit.id, nom: produit.nom, message: err instanceof Error ? err.message : 'Erreur' });
      }
    }

    // Du stock vient d'entrer : les colis de plateforme qui l'attendaient
    // sont servis, dans leur ordre d'arrivée (§ lib/stock-reservation.ts).
    await servirColisEnAttente(valides, session.sub);

    return NextResponse.json({ valides: valides.length, unites, erreurs });
  } catch (error) {
    return jsonError(error);
  }
}
