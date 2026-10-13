import { NextResponse } from 'next/server';
import { synchroniserCreancesSansErreur } from '@/lib/reglements-transporteurs';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { STATUTS_COMMANDE, STATUTS_TERMINAUX } from '@/lib/statuts';
import type { Role, StatutCommande } from '@/app/generated/prisma/enums';
import { notifierStatutsColis } from '@/lib/notifications';

// Rôles autorisés à changer le statut d'un colis. Contrairement à l'ancien
// pipeline logistique linéaire, le cycle "call-center" (27 statuts) n'a pas
// d'ordre strict — un agent peut passer de "Boîte vocale" à "Programmé" puis
// "Injoignable" sans séquence imposée. Le contrôle se fait donc par rôle,
// avec seulement deux garde-fous ciblés ci-dessous (preuve / motif).
// equipe_suivi reprend le périmètre de l'ancien agent_confirmation, moderateur
// celui de l'ancien sav (retours/refus) ; superviseur a une portée large.
//
// `livreur` n'y figure plus : il a sa route dédiée
// (/api/livreur/colis/[id]/statut), qui vérifie que le colis lui est confié,
// que sa tournée est ouverte et que la transition est permise. Ici, il pouvait
// changer le statut de N'IMPORTE QUEL colis — repasser un colis encaissé en
// retour, par exemple, et faire sortir son COD du bilan de tournée.
const ROLES_AUTORISES: Role[] = ['admin', 'superviseur', 'equipe_suivi', 'moderateur'];

const STATUTS_REQUIS_PREUVE: StatutCommande[] = ['livre'];
const STATUTS_REQUIS_MOTIF: StatutCommande[] = ['retourne', 'refuse', 'annule', 'annule_par_vendeur'];

// La transition attente_de_ramassage -> ramasse reste réservée au scan de
// ramassage (RG-13, POST /api/commandes/scan) ; l'admin peut cependant
// l'outrepasser directement.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_AUTORISES);
    const { id } = await params;
    const body = await request.json();
    const nouveauStatut = body.statut as StatutCommande | undefined;

    if (!nouveauStatut || !STATUTS_COMMANDE.includes(nouveauStatut)) {
      throw new ApiError(400, 'Le champ statut est requis et doit être une valeur valide');
    }

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    // Un colis clos (livré, retourné, annulé) ou déjà entré en facturation ne
    // se rouvre que par l'admin : le statut et le COD y ont déjà produit leurs
    // effets comptables (bilan de tournée, facture marchand).
    if (session.role !== 'admin') {
      if (STATUTS_TERMINAUX.includes(commande.statut) && nouveauStatut !== commande.statut) {
        throw new ApiError(409, 'Ce colis est clos : seul un admin peut en changer le statut');
      }
      if (commande.etatPaiement !== 'non_paye') {
        throw new ApiError(409, 'Ce colis est déjà facturé ou payé : seul un admin peut en changer le statut');
      }
    }

    if (
      commande.statut === 'attente_de_ramassage' &&
      nouveauStatut === 'ramasse' &&
      session.role !== 'admin'
    ) {
      throw new ApiError(
        400,
        'La transition attente_de_ramassage → ramasse ne peut pas se faire via cet endpoint pour ce rôle : elle exige un scan de ramassage (POST /api/commandes/scan).'
      );
    }

    // La transition ramasse -> recu_au_hub reste réservée au scan de
    // réception Agent Hub (POST /api/commandes/scan-reception), même
    // principe que ci-dessus ; l'admin peut cependant l'outrepasser directement.
    if (commande.statut === 'ramasse' && nouveauStatut === 'recu_au_hub' && session.role !== 'admin') {
      throw new ApiError(
        400,
        'La transition ramasse → recu_au_hub ne peut pas se faire via cet endpoint pour ce rôle : elle exige un scan de réception (POST /api/commandes/scan-reception).'
      );
    }

    // Les transitions recu_au_hub <-> en_transit restent réservées au module
    // Bon d'Envoi (§ /admin/bon-envoi, POST /api/bons-envoi et
    // POST /api/bons-envoi/[id]/marquer-recu), même principe que ci-dessus ;
    // l'admin peut cependant les outrepasser directement.
    if (commande.statut === 'recu_au_hub' && nouveauStatut === 'en_transit' && session.role !== 'admin') {
      throw new ApiError(
        400,
        "La transition recu_au_hub → en_transit ne peut pas se faire via cet endpoint pour ce rôle : elle exige la création d'un Bon d'Envoi (POST /api/bons-envoi)."
      );
    }
    if (commande.statut === 'en_transit' && nouveauStatut === 'recu_au_hub' && session.role !== 'admin') {
      throw new ApiError(
        400,
        "La transition en_transit → recu_au_hub ne peut pas se faire via cet endpoint pour ce rôle : elle exige la réception du Bon d'Envoi (POST /api/bons-envoi/[id]/marquer-recu)."
      );
    }

    const photoPreuveUrl = typeof body.photoPreuveUrl === 'string' ? body.photoPreuveUrl : undefined;
    const signatureUrl = typeof body.signatureUrl === 'string' ? body.signatureUrl : undefined;
    const motifRetour = typeof body.motifRetour === 'string' ? body.motifRetour.trim() : undefined;

    if (STATUTS_REQUIS_PREUVE.includes(nouveauStatut) && !photoPreuveUrl && !signatureUrl) {
      throw new ApiError(400, 'Une preuve de livraison (photo ou signature) est requise'); // RG-02
    }
    if (STATUTS_REQUIS_MOTIF.includes(nouveauStatut) && !motifRetour) {
      throw new ApiError(400, 'Un motif est requis pour ce statut'); // RG-04
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      // Écriture conditionnée au statut lu : si un scan ou un webhook l'a
      // changé entre-temps, on refuse plutôt que d'écraser (ex. un `livre`).
      const ecrit = await tx.commande.updateMany({
        where: { id, statut: commande.statut },
        data: {
          statut: nouveauStatut,
          ...(nouveauStatut === 'ramasse' && { dateCollecte: now }),
          ...(nouveauStatut === 'livre' && { dateLivraison: now, photoPreuveUrl, signatureUrl }),
          ...(STATUTS_REQUIS_MOTIF.includes(nouveauStatut) && { motifRetour }),
        },
      });
      if (ecrit.count !== 1) {
        throw new ApiError(409, 'Le statut de ce colis vient de changer — rechargez la page');
      }

      // RG-10 : historisation de chaque changement de statut.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: id,
          ancienStatut: commande.statut,
          nouveauStatut,
          utilisateurId: session.sub,
        },
      });

      return tx.commande.findUniqueOrThrow({ where: { id } });
    });

    // § Notifications : après la transaction (le statut est acquis) ; le tri
    // des statuts qui méritent d'être annoncés est fait par le helper.
    if (nouveauStatut !== commande.statut) {
      await notifierStatutsColis([{ commandeId: id, statut: nouveauStatut }], { sauf: session.sub });
    }

    // § Règlements transporteurs : livré (ou correction) → créance tenue à jour.
    await synchroniserCreancesSansErreur([updated.id]);
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
