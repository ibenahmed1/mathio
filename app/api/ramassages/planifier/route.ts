import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';

function debutJournee(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// RG-16 : simule le planificateur récurrent (pas de vrai cron dans ce
// scénario — endpoint admin déclenchable à la demande pour tester la règle).
// Ne crée une tournée pour un marchand que s'il existe au moins un colis
// `confirmee` sans `ramassage_id`, et jamais deux fois pour le même jour.
export async function POST() {
  try {
    await requireUser(['admin']);
    const aujourdHui = debutJournee(new Date());

    const marchands = await prisma.marchand.findMany({
      where: { ramassageRecurrentActif: true, statut: 'actif' },
      include: { adresses: { orderBy: { estParDefaut: 'desc' }, take: 1 } },
    });

    const crees: unknown[] = [];
    const ignores: { marchandId: string; nomBoutique: string; raison: string }[] = [];

    for (const marchand of marchands) {
      const nbColisEnAttente = await prisma.commande.count({
        where: { marchandId: marchand.id, statut: 'attente_de_ramassage', ramassageId: null },
      });

      if (nbColisEnAttente === 0) {
        ignores.push({ marchandId: marchand.id, nomBoutique: marchand.nomBoutique, raison: "aucun colis en attente de ramassage" });
        continue;
      }

      const adresse = marchand.adresses[0];
      if (!adresse) {
        ignores.push({ marchandId: marchand.id, nomBoutique: marchand.nomBoutique, raison: "aucune adresse de collecte configurée" });
        continue;
      }

      const dejaPlanifie = await prisma.ramassage.findFirst({
        where: {
          marchandId: marchand.id,
          modeCreation: 'recurrent',
          datePrevue: aujourdHui,
          statut: { not: 'annulee' },
        },
      });
      if (dejaPlanifie) {
        ignores.push({ marchandId: marchand.id, nomBoutique: marchand.nomBoutique, raison: "tournée récurrente déjà planifiée aujourd'hui" });
        continue;
      }

      const ramassage = await prisma.ramassage.create({
        data: {
          marchandId: marchand.id,
          adresseId: adresse.id,
          datePrevue: aujourdHui,
          creneauHoraire: marchand.ramassageCreneauHoraire,
          modeCreation: 'recurrent',
          initieParId: null,
          nbColisEstimes: nbColisEnAttente,
          statut: 'en_attente',
        },
      });
      crees.push(ramassage);
    }

    return NextResponse.json({ crees, ignores });
  } catch (error) {
    return jsonError(error);
  }
}
