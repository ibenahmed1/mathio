import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { STATUTS_AVANT_COLLECTE, STATUTS_INJOIGNABLES, STATUTS_TERMINAUX } from '@/lib/statuts';

const MOIS_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfWeekMonday(d: Date) {
  const r = startOfDay(d);
  const jour = (r.getDay() + 6) % 7; // 0 = lundi
  r.setDate(r.getDate() - jour);
  return r;
}

function startOfMonth(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

function deltaPct(actuel: number, precedent: number) {
  if (precedent === 0) return actuel > 0 ? 100 : 0;
  return Math.round(((actuel - precedent) / precedent) * 1000) / 10;
}

// RF-XX : agrégats du tableau de bord marchand, filtrables par période
// (mois en cours / semaine en cours / aujourd'hui / date précise choisie).
export async function GET(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const marchandId = marchand.id;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const periodParam = searchParams.get('period');
    const now = new Date();

    let start: Date;
    let end: Date;
    if (dateParam) {
      start = startOfDay(new Date(dateParam));
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    } else {
      end = now;
      const period = periodParam === '1' ? 1 : periodParam === '2' ? 2 : 0;
      start = period === 0 ? startOfMonth(now) : period === 1 ? startOfWeekMonday(now) : startOfDay(now);
    }
    const dureeMs = end.getTime() - start.getTime();
    const prevEnd = start;
    const prevStart = new Date(start.getTime() - dureeMs);

    const debut5Mois = new Date(now.getFullYear(), now.getMonth() - 4, 1);
    debut5Mois.setHours(0, 0, 0, 0);

    const [
      totalColisPeriode,
      colisLivresPeriode,
      colisEnCoursPeriode,
      colisInjoignablesPeriode,
      colisAnnulesPeriode,
      colisCollectesPeriode,
      brutAgg,
      encaisseAgg,
      colisLivresPrev,
      totalColisPrev,
      commandes5Mois,
    ] = await Promise.all([
      prisma.commande.count({ where: { marchandId, dateCreation: { gte: start, lt: end } } }),
      prisma.commande.count({ where: { marchandId, dateCreation: { gte: start, lt: end }, statut: 'livre' } }),
      prisma.commande.count({
        where: { marchandId, dateCreation: { gte: start, lt: end }, statut: { notIn: STATUTS_TERMINAUX } },
      }),
      prisma.commande.count({
        where: { marchandId, dateCreation: { gte: start, lt: end }, statut: { in: STATUTS_INJOIGNABLES } },
      }),
      prisma.commande.count({
        where: { marchandId, dateCreation: { gte: start, lt: end }, statut: { in: ['annule', 'annule_par_vendeur'] } },
      }),
      prisma.commande.count({
        where: { marchandId, dateCreation: { gte: start, lt: end }, statut: { notIn: STATUTS_AVANT_COLLECTE } },
      }),
      prisma.commande.aggregate({
        where: {
          marchandId,
          dateCreation: { gte: start, lt: end },
          statut: { notIn: ['annule', 'annule_par_vendeur'] },
        },
        _sum: { montantCod: true },
      }),
      prisma.commande.aggregate({
        where: { marchandId, dateCreation: { gte: start, lt: end }, etatPaiement: 'paye' },
        _sum: { montantCod: true },
      }),
      prisma.commande.count({ where: { marchandId, dateCreation: { gte: prevStart, lt: prevEnd }, statut: 'livre' } }),
      prisma.commande.count({ where: { marchandId, dateCreation: { gte: prevStart, lt: prevEnd } } }),
      prisma.commande.findMany({
        where: { marchandId, dateCreation: { gte: debut5Mois } },
        select: { dateCreation: true, statut: true },
      }),
    ]);

    const moisBuckets = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
      return { annee: d.getFullYear(), mois: d.getMonth(), label: MOIS_COURT[d.getMonth()], livre: 0, total: 0 };
    });
    for (const c of commandes5Mois) {
      const bucket = moisBuckets.find((b) => b.annee === c.dateCreation.getFullYear() && b.mois === c.dateCreation.getMonth());
      if (!bucket) continue;
      bucket.total += 1;
      if (c.statut === 'livre') bucket.livre += 1;
    }

    const tauxLivraisonPeriode = totalColisPeriode > 0 ? Math.round((colisLivresPeriode / totalColisPeriode) * 1000) / 10 : 0;
    const tauxLivraisonPrev = totalColisPrev > 0 ? Math.round((colisLivresPrev / totalColisPrev) * 1000) / 10 : 0;
    const brut = Number(brutAgg._sum.montantCod ?? 0);
    const encaisse = Number(encaisseAgg._sum.montantCod ?? 0);

    return NextResponse.json({
      kpiCards: {
        collecte: colisCollectesPeriode,
        colisEnCours: colisEnCoursPeriode,
        colisInjoignables: colisInjoignablesPeriode,
        colisAnnules: colisAnnulesPeriode,
      },
      stats: {
        totalColis: totalColisPeriode,
        colisLivre: colisLivresPeriode,
        colisLivreDeltaPct: deltaPct(colisLivresPeriode, colisLivresPrev),
        tauxLivraison: tauxLivraisonPeriode,
        tauxLivraisonDeltaPts: deltaPct(tauxLivraisonPeriode, tauxLivraisonPrev),
      },
      bars: moisBuckets.map((b) => ({ label: b.label, livre: b.livre, total: b.total })),
      // Panneau CRBT du dashboard. Mêmes deux agrégats que le taux
      // d'encaissement ci-dessous, pour que le montant affiché et le
      // pourcentage ne puissent pas se contredire.
      crbt: {
        brut,
        rembourse: encaisse,
        aRembourser: Math.max(0, Math.round((brut - encaisse) * 100) / 100),
      },
      rates: {
        livraison: tauxLivraisonPeriode,
        collecte: totalColisPeriode > 0 ? Math.round((colisCollectesPeriode / totalColisPeriode) * 1000) / 10 : 0,
        encaissement: brut > 0 ? Math.round((encaisse / brut) * 1000) / 10 : 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
