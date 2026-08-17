import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { ROLES_BACKOFFICE } from '@/lib/auth';

const ROLES_LECTURE_COMMANDE = [...ROLES_BACKOFFICE, 'marchand', 'ramasseur', 'livreur'] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_LECTURE_COMMANDE]);
    const { id } = await params;

    const commande = await prisma.commande.findUnique({
      where: { id },
      include: {
        historique: { orderBy: { horodatage: 'asc' }, include: { utilisateur: { select: { nomComplet: true } } } },
        commentaires: { orderBy: { dateCreation: 'asc' }, include: { utilisateur: { select: { nomComplet: true } } } },
        livreur: { select: { id: true, nomComplet: true } },
        marchand: { select: { nomBoutique: true } },
        ramassage: { include: { ramasseur: { select: { nomComplet: true } } } },
        marchandise: { select: { id: true, nom: true, prix: true } },
        produit: { select: { id: true, nom: true, reference: true, photoUrl: true } },
        colisARemplacer: { select: { id: true, codeSuivi: true } },
        hubActuel: { select: { id: true, nom: true, ville: true } },
      },
    });

    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    // RG-07 / RNF-02 : cloisonnement des données par rôle.
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand || commande.marchandId !== marchand.id) {
        throw new ApiError(403, 'Accès refusé à cette commande');
      }
    } else if (session.role === 'ramasseur' && commande.ramasseurId !== session.sub) {
      throw new ApiError(403, 'Accès refusé à cette commande');
    } else if (session.role === 'livreur' && commande.livreurId !== session.sub) {
      throw new ApiError(403, 'Accès refusé à cette commande');
    }

    return NextResponse.json(commande);
  } catch (error) {
    return jsonError(error);
  }
}

// Édition libre des champs colis. L'admin peut tout modifier (y compris
// livreur/CIN/prix, cf. actions "Change Ville", "Changer le prix"…). Le
// marchand ne peut modifier que les champs qu'il a lui-même saisis à la
// création de son propre colis (RG : "n'importe quelle donnée saisie à la
// main doit rester modifiable") — pas le livreur assigné ni la preuve CIN,
// qui relèvent de l'opération logistique.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { id } = await params;
    const body = await request.json();

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    let marchandId: string | null = null;
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand || commande.marchandId !== marchand.id) {
        throw new ApiError(403, 'Accès refusé à cette commande');
      }
      marchandId = marchand.id;
    }

    let nouveauLivreurNom: string | null = null;
    if (session.role === 'admin' && body.livreurId !== undefined && body.livreurId !== null) {
      const livreur = await prisma.utilisateur.findUnique({ where: { id: body.livreurId } });
      if (!livreur || livreur.role !== 'livreur') {
        throw new ApiError(400, 'livreurId doit référencer un utilisateur avec le rôle livreur');
      }
      nouveauLivreurNom = livreur.nomComplet;
    }
    // § Suivi colis / circuit : l'affectation d'un livreur (assignation
    // directe depuis la liste des colis, hors Bon de Distribution — qui
    // journalise déjà l'affectation dans HistoriqueStatutCommande.note) ne
    // laissait jusqu'ici aucune trace consultable, alors que c'est justement
    // l'information que le suivi doit montrer en premier : qui livre le
    // colis, pas seulement qui a effectué l'action d'affectation.
    const livreurModifie = session.role === 'admin' && body.livreurId !== undefined && body.livreurId !== commande.livreurId;

    const data: Record<string, unknown> = {};
    if (typeof body.clientNom === 'string' && body.clientNom.trim()) data.clientNom = body.clientNom.trim();
    if (typeof body.clientTelephone === 'string' && body.clientTelephone.trim()) data.clientTelephone = body.clientTelephone.trim();
    if (typeof body.ville === 'string' && body.ville.trim()) data.ville = body.ville.trim();
    if (typeof body.adresse === 'string' && body.adresse.trim()) data.adresse = body.adresse.trim();
    if (typeof body.produitDescription === 'string') data.produitDescription = body.produitDescription.trim() || null;
    if (typeof body.notes === 'string') data.notes = body.notes.trim() || null;
    if (body.ouvrir !== undefined) data.ouvrir = Boolean(body.ouvrir);
    if (body.fragile !== undefined) data.fragile = Boolean(body.fragile);
    if (body.aRemplacer !== undefined) data.aRemplacer = Boolean(body.aRemplacer);
    if (body.enStock !== undefined) data.enStock = Boolean(body.enStock);
    if (Number.isInteger(Number(body.quantite)) && Number(body.quantite) > 0) data.quantite = Number(body.quantite);
    if (body.montantCod !== undefined) {
      const montant = Number(body.montantCod);
      if (!Number.isFinite(montant) || montant <= 0) {
        throw new ApiError(400, 'montantCod doit être un nombre positif');
      }
      data.montantCod = montant;
    }

    // Marchandise du catalogue : réassignable, toujours vérifiée dans le
    // périmètre du marchand propriétaire du colis (pas celui de l'appelant
    // admin, qui n'a pas de catalogue propre).
    if (body.marchandiseId !== undefined) {
      if (body.marchandiseId === null || body.marchandiseId === '') {
        data.marchandiseId = null;
      } else {
        const marchandise = await prisma.marchandise.findUnique({ where: { id: body.marchandiseId } });
        if (!marchandise || marchandise.marchandId !== commande.marchandId) {
          throw new ApiError(400, 'marchandiseId invalide pour ce marchand');
        }
        data.marchandiseId = marchandise.id;
      }
    }

    // Produit du stock : réassignable, toujours vérifié dans le périmètre du
    // marchand propriétaire du colis (même garde que marchandiseId ci-dessus).
    if (body.produitId !== undefined) {
      if (body.produitId === null || body.produitId === '') {
        data.produitId = null;
      } else {
        const produit = await prisma.produit.findUnique({ where: { id: body.produitId } });
        if (!produit || produit.marchandId !== commande.marchandId) {
          throw new ApiError(400, 'produitId invalide pour ce marchand');
        }
        data.produitId = produit.id;
      }
    }

    if (body.colisARemplacerCode !== undefined) {
      const code = typeof body.colisARemplacerCode === 'string' ? body.colisARemplacerCode.trim() : '';
      if (!code) {
        data.colisARemplacerId = null;
      } else {
        const cible = await prisma.commande.findUnique({ where: { codeSuivi: code } });
        if (!cible || cible.marchandId !== commande.marchandId || cible.id === commande.id) {
          throw new ApiError(400, `Colis à remplacer introuvable pour le code ${code}`);
        }
        data.colisARemplacerId = cible.id;
      }
    }

    // Champs réservés à l'admin (opération logistique, pas de saisie manuelle marchand).
    if (session.role === 'admin') {
      if (typeof body.cinUrl === 'string') data.cinUrl = body.cinUrl || null;
      if (body.livreurId !== undefined) data.livreurId = body.livreurId || null;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ modifiable fourni');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({ where: { id }, data });

      if (livreurModifie) {
        const ancienLivreurNom = commande.livreurId
          ? (await tx.utilisateur.findUnique({ where: { id: commande.livreurId }, select: { nomComplet: true } }))?.nomComplet ?? null
          : null;

        let texteCommentaire: string;
        if (nouveauLivreurNom && ancienLivreurNom) {
          texteCommentaire = `Colis réaffecté au livreur ${nouveauLivreurNom} (précédemment ${ancienLivreurNom}) — c'est lui qui livre désormais ce colis.`;
        } else if (nouveauLivreurNom) {
          texteCommentaire = `Colis affecté au livreur ${nouveauLivreurNom} — c'est lui qui livre ce colis.`;
        } else {
          texteCommentaire = `Livreur retiré du colis${ancienLivreurNom ? ` (était ${ancienLivreurNom})` : ''}.`;
        }

        await tx.commentaireCommande.create({
          data: { commandeId: id, utilisateurId: session.sub, texte: texteCommentaire },
        });
      }

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression définitive. Restreinte au statut 'nouveau_colis' : dès qu'un
// colis a été engagé (ramassage, bon de livraison/préparation, tournée…), on
// annule via PATCH .../statut plutôt que de perdre l'historique logistique.
// À ce statut, historique/commentaires sont les seules FK qui bloqueraient un
// DELETE (RESTRICT), donc on les purge explicitement dans la transaction.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { id } = await params;

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand || commande.marchandId !== marchand.id) {
        throw new ApiError(403, 'Accès refusé à cette commande');
      }
    }

    if (commande.statut !== 'nouveau_colis') {
      throw new ApiError(400, 'Seul un colis au statut "Nouveau Colis" peut être supprimé — annulez-le sinon');
    }

    await prisma.$transaction([
      prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: id } }),
      prisma.commentaireCommande.deleteMany({ where: { commandeId: id } }),
      prisma.commande.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
