import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser();
    const statut = request.nextUrl.searchParams.get('statut');

    const where: { marchandId?: string; statut?: 'en_attente' | 'confirmee' | 'effectuee' | 'annulee' } = {};
    if (statut) {
      where.statut = statut as 'en_attente' | 'confirmee' | 'effectuee' | 'annulee';
    }

    // RG-07 / RNF-02 : un marchand ne voit que ses propres tournées.
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
      where.marchandId = marchand.id;
    }

    const ramassages = await prisma.ramassage.findMany({
      where,
      orderBy: { datePrevue: 'desc' },
      include: {
        marchand: { select: { nomBoutique: true } },
        adresse: { select: { libelle: true, adresseComplete: true } },
        ramasseur: { select: { nomComplet: true } },
        _count: { select: { commandes: true } },
      },
    });

    return NextResponse.json({ data: ramassages });
  } catch (error) {
    return jsonError(error);
  }
}

// RF-25 : demande de ramassage ponctuelle par le marchand (modèle hybride, §5.6).
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const body = await request.json();

    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const adresseId = typeof body.adresseId === 'string' ? body.adresseId : '';
    const datePrevue = typeof body.datePrevue === 'string' ? new Date(body.datePrevue) : null;

    if (!adresseId || !datePrevue || Number.isNaN(datePrevue.getTime())) {
      throw new ApiError(400, 'adresseId et datePrevue (date valide) sont requis');
    }

    const adresse = await prisma.adresseMarchand.findUnique({ where: { id: adresseId } });
    if (!adresse || adresse.marchandId !== marchand.id) {
      throw new ApiError(404, "Adresse introuvable pour ce marchand");
    }

    const ramassage = await prisma.ramassage.create({
      data: {
        marchandId: marchand.id,
        adresseId,
        datePrevue,
        creneauHoraire: typeof body.creneauHoraire === 'string' ? body.creneauHoraire : null,
        modeCreation: 'manuel',
        initieParId: session.sub,
        nbColisEstimes: Number.isInteger(body.nbColisEstimes) ? body.nbColisEstimes : null,
        statut: 'en_attente',
      },
    });

    return NextResponse.json(ramassage, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
