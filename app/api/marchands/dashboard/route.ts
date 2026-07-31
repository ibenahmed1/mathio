import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { STATUTS_A_RELANCER } from '@/lib/statuts';

const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

function jourCle(date: Date) {
  return date.toISOString().slice(0, 10);
}

// RF-XX : agrégats du tableau de bord marchand (KPI, évolution 7 jours, répartition des statuts).
export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const marchandId = marchand.id;
    const debut7j = new Date();
    debut7j.setHours(0, 0, 0, 0);
    debut7j.setDate(debut7j.getDate() - 6);
    const debutAujourdhui = new Date();
    debutAujourdhui.setHours(0, 0, 0, 0);

    const [
      totalColis,
      colisLivres,
      colisEnCours,
      demandesRamassage,
      totalCodAgg,
      statutGroupes,
      commandes7j,
      derniersColis,
      aTraiterAujourdhui,
      poolClientsRecents,
    ] = await Promise.all([
      prisma.commande.count({ where: { marchandId } }),
      prisma.commande.count({ where: { marchandId, statut: 'livre' } }),
      prisma.commande.count({
        where: { marchandId, statut: { notIn: ['livre', 'retourne', 'annule', 'annule_par_vendeur'] } },
      }),
      prisma.ramassage.count({ where: { marchandId, statut: 'en_attente' } }),
      prisma.commande.aggregate({
        where: { marchandId, statut: { notIn: ['annule', 'annule_par_vendeur'] } },
        _sum: { montantCod: true },
      }),
      // Colis "à relancer" (échec de livraison) : exclus de la répartition du
      // donut, ils ont leur propre écran dédié (marchand/colis/relance) et ne
      // doivent pas apparaître comme un statut final parmi d'autres.
      prisma.commande.groupBy({
        by: ['statut'],
        where: { marchandId, statut: { notIn: STATUTS_A_RELANCER } },
        _count: { _all: true },
      }),
      prisma.commande.findMany({
        where: { marchandId, dateCreation: { gte: debut7j } },
        select: { dateCreation: true, montantCod: true, etatPaiement: true },
      }),
      prisma.commande.findMany({
        where: { marchandId },
        orderBy: { dateCreation: 'desc' },
        take: 5,
      }),
      // Colis créés aujourd'hui ou encore en attente de ramassage : base du
      // widget "Colis à traiter aujourd'hui" (colonne agenda du dashboard).
      prisma.commande.findMany({
        where: {
          marchandId,
          OR: [{ dateCreation: { gte: debutAujourdhui } }, { statut: 'attente_de_ramassage' }],
        },
        orderBy: { dateCreation: 'desc' },
        take: 6,
        select: { id: true, codeSuivi: true, clientNom: true, ville: true, statut: true, dateCreation: true },
      }),
      // Pool de commandes récentes servant à dériver les derniers clients
      // distincts (widget "Derniers clients" de la colonne agenda).
      prisma.commande.findMany({
        where: { marchandId },
        orderBy: { dateCreation: 'desc' },
        take: 20,
        select: { clientNom: true, clientTelephone: true, ville: true, dateCreation: true },
      }),
    ]);

    const jours: { date: string; label: string }[] = [];
    const compteursParJour = new Map<string, number>();
    const payeParJour = new Map<string, number>();
    const enAttenteParJour = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(debut7j);
      d.setDate(d.getDate() + i);
      const cle = jourCle(d);
      jours.push({ date: cle, label: JOURS[d.getDay()] });
      compteursParJour.set(cle, 0);
      payeParJour.set(cle, 0);
      enAttenteParJour.set(cle, 0);
    }
    for (const c of commandes7j) {
      const cle = jourCle(c.dateCreation);
      if (compteursParJour.has(cle)) {
        compteursParJour.set(cle, (compteursParJour.get(cle) ?? 0) + 1);
        const montant = Number(c.montantCod);
        if (c.etatPaiement === 'paye') {
          payeParJour.set(cle, (payeParJour.get(cle) ?? 0) + montant);
        } else {
          enAttenteParJour.set(cle, (enAttenteParJour.get(cle) ?? 0) + montant);
        }
      }
    }
    const evolution7j = jours.map(({ date, label }) => ({ date, label, count: compteursParJour.get(date) ?? 0 }));
    // Double série réelle (COD encaissé vs COD en attente) pour le widget
    // "Suivi des revenus" de la colonne centrale — pas de données inventées.
    const paiements7j = jours.map(({ date, label }) => ({
      date,
      label,
      paye: payeParJour.get(date) ?? 0,
      enAttente: enAttenteParJour.get(date) ?? 0,
    }));

    const statutRepartition = statutGroupes.map((g) => ({ statut: g.statut, count: g._count._all }));

    // Taux livré / retourné / annulé : dérivés de la répartition des statuts
    // déjà chargée (pas de requête supplémentaire), rapportés au total des colis.
    const compteParStatut = new Map(statutGroupes.map((g) => [g.statut, g._count._all]));
    const colisRetournes = compteParStatut.get('retourne') ?? 0;
    const colisAnnules = (compteParStatut.get('annule') ?? 0) + (compteParStatut.get('annule_par_vendeur') ?? 0);
    const tauxLivre = totalColis > 0 ? Math.round((colisLivres / totalColis) * 1000) / 10 : 0;
    const tauxRetourne = totalColis > 0 ? Math.round((colisRetournes / totalColis) * 1000) / 10 : 0;
    const tauxAnnule = totalColis > 0 ? Math.round((colisAnnules / totalColis) * 1000) / 10 : 0;

    const clientsVus = new Set<string>();
    const derniersClients: { nom: string; ville: string; date: Date }[] = [];
    for (const c of poolClientsRecents) {
      const cle = c.clientTelephone || c.clientNom;
      if (clientsVus.has(cle)) continue;
      clientsVus.add(cle);
      derniersClients.push({ nom: c.clientNom, ville: c.ville, date: c.dateCreation });
      if (derniersClients.length >= 6) break;
    }

    return NextResponse.json({
      kpi: {
        totalColis,
        colisLivres,
        colisEnCours,
        demandesRamassage,
        totalCod: Number(totalCodAgg._sum.montantCod ?? 0),
        tauxLivre,
        tauxRetourne,
        tauxAnnule,
      },
      evolution7j,
      paiements7j,
      statutRepartition,
      derniersColis,
      aTraiterAujourdhui,
      derniersClients,
    });
  } catch (error) {
    return jsonError(error);
  }
}
