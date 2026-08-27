import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getBilanTournee } from '@/lib/bon-distribution';

// § Clôture de tournée (/admin/bon-distribution/[id]/cloture), dernière
// étape : le Planner a scanné tous les retours, il compte l'argent et ferme.
//
// Deux volets STRICTEMENT séparés, c'est la règle métier centrale de ce
// module :
//   A. Caisse — le livreur remet 100 % du CRBT collecté, sans aucune
//      déduction. Le montant attendu est la somme des montantCod des colis
//      livrés ; la clôture est refusée si le cash compté est inférieur
//      (tolérance zéro sur le manquant). Un excédent est accepté et tracé
//      dans ecartCaisse.
//   B. Rémunération — (colis livrés x tarif livraison) + (colis retournés x
//      tarif refus) est crédité au solde à payer du livreur, réglé plus tard
//      par un processus comptable distinct (§ Bon de paiement livreur). Cette
//      somme ne touche JAMAIS la caisse ci-dessus.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;
    const body = await request.json();

    // getBilanTournee applique déjà la garde de hub (planner = son hub).
    const bilan = await getBilanTournee(session, id);

    if (bilan.statut === 'cloture') {
      throw new ApiError(409, 'Cette tournée est déjà clôturée');
    }
    if (!bilan.pretACloturer) {
      throw new ApiError(
        409,
        `${bilan.colisARecuperer.length} colis non livré(s) n'ont pas encore été scannés au retour — la tournée ne peut pas être clôturée.`
      );
    }

    const montantRemisBrut = typeof body.montantRemis === 'number' ? body.montantRemis : Number(body.montantRemis);
    if (!Number.isFinite(montantRemisBrut) || montantRemisBrut < 0) {
      throw new ApiError(400, 'montantRemis est requis et doit être un montant positif');
    }
    const montantRemis = Number(montantRemisBrut.toFixed(2));

    if (montantRemis < bilan.montantCrbtAttendu) {
      throw new ApiError(
        409,
        `Manquant de caisse : ${(bilan.montantCrbtAttendu - montantRemis).toFixed(2)} DH. Le livreur doit remettre l'intégralité du CRBT encaissé (${bilan.montantCrbtAttendu.toFixed(2)} DH) avant la fermeture de la tournée.`
      );
    }

    const ecartCaisse = Number((montantRemis - bilan.montantCrbtAttendu).toFixed(2));
    const now = new Date();

    const bon = await prisma.$transaction(async (tx) => {
      // Re-contrôle dans la transaction : un livreur peut avoir marqué un
      // colis entre le calcul du bilan et le clic (le bilan est recalculé à
      // chaque rafraîchissement de l'écran, pas verrouillé).
      const encoreDehors = await tx.commande.count({
        where: { bonDistributionId: id, statut: { notIn: ['livre', 'retourne_au_hub'] } },
      });
      if (encoreDehors > 0) {
        throw new ApiError(409, `${encoreDehors} colis sont revenus dans la tournée entre-temps — rafraîchissez le bilan.`);
      }

      // Gel de la rémunération COLIS PAR COLIS (§ Commande.fraisLivreur) : le
      // tarif vient d'être résolu pour chacun, c'est le seul instant où il est
      // certain. Une grille modifiée demain ne doit rien réécrire de ce qui a
      // été gagné aujourd'hui — même garantie que gainLivreur, mais au niveau
      // de détail qu'exige une fiche de paie.
      //
      // Groupé par (montant, nature) plutôt qu'un UPDATE par colis : une
      // tournée porte des dizaines de colis pour deux ou trois tarifs
      // distincts, ce qui ramène la boucle à deux ou trois requêtes.
      const groupes = new Map<string, { frais: number; livre: boolean; ids: string[] }>();
      for (const ligne of bilan.fraisParColis) {
        const cle = `${ligne.frais}|${ligne.livre}`;
        const groupe = groupes.get(cle) ?? { frais: ligne.frais, livre: ligne.livre, ids: [] };
        groupe.ids.push(ligne.colisId);
        groupes.set(cle, groupe);
      }
      for (const groupe of groupes.values()) {
        await tx.commande.updateMany({
          where: { id: { in: groupe.ids } },
          data: { fraisLivreur: groupe.frais, fraisLivreurLivre: groupe.livre },
        });
      }

      // Écriture comptable d'entrée de caisse (§ /admin/comptabilite) : le
      // montant physiquement reçu, pas le théorique — l'écart éventuel reste
      // lisible sur la tournée.
      const transaction = await tx.transaction.create({
        data: {
          montant: montantRemis,
          type: 'revenu',
          categorie: 'paiement_client',
          dateEffet: now,
          description: `Remise de caisse tournée ${bilan.numero} — ${bilan.livreur.nomComplet} (${bilan.colisLivres.length} colis livrés, Hub ${bilan.hub.nom})`,
          auteurId: session.sub,
        },
      });

      return tx.bonDistribution.update({
        where: { id },
        data: {
          statut: 'cloture',
          dateCloture: now,
          clotureParId: session.sub,
          nbColisLivres: bilan.colisLivres.length,
          nbColisRetournes: bilan.colisRetournes.length,
          montantCrbtAttendu: bilan.montantCrbtAttendu,
          montantRemis,
          ecartCaisse,
          gainLivreur: bilan.gainLivreur,
          transactionId: transaction.id,
        },
        include: {
          livreur: { select: { nomComplet: true } },
          hub: { select: { nom: true } },
          cloturePar: { select: { nomComplet: true } },
        },
      });
    });

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}
