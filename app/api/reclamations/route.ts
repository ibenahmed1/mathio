import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['marchand', 'admin', 'moderateur', 'superviseur']);
    const statut = request.nextUrl.searchParams.get('statut');

    const where: { marchandId?: string; statut?: 'ouverte' | 'en_cours' | 'resolue' | 'rejetee' } = {};
    if (statut) where.statut = statut as 'ouverte' | 'en_cours' | 'resolue' | 'rejetee';

    // RG-07 / RNF-02 : un marchand ne voit que ses propres réclamations.
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
      where.marchandId = marchand.id;
    }

    const reclamations = await prisma.reclamation.findMany({
      where,
      orderBy: { dateCreation: 'desc' },
      include: {
        marchand: { select: { nomBoutique: true } },
        commande: { select: { id: true, codeSuivi: true } },
        utilisateur: { select: { nomComplet: true } },
      },
    });

    return NextResponse.json({ data: reclamations });
  } catch (error) {
    return jsonError(error);
  }
}

// Le marchand ouvre une réclamation (SAV), optionnellement rattachée à un colis.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
    const body = await request.json();

    const sujet = typeof body.sujet === 'string' ? body.sujet.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!sujet || !message) {
      throw new ApiError(400, 'sujet et message sont requis');
    }

    let commandeId: string | null = null;
    if (typeof body.commandeId === 'string' && body.commandeId) {
      const commande = await prisma.commande.findUnique({ where: { id: body.commandeId } });
      if (!commande || commande.marchandId !== marchand.id) {
        throw new ApiError(400, 'commandeId invalide pour ce marchand');
      }
      commandeId = commande.id;
    }

    const reclamation = await prisma.reclamation.create({
      data: {
        marchandId: marchand.id,
        commandeId,
        utilisateurId: session.sub,
        sujet,
        message,
        statut: 'ouverte',
      },
      include: {
        commande: { select: { id: true, codeSuivi: true } },
        utilisateur: { select: { nomComplet: true } },
      },
    });

    return NextResponse.json(reclamation, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
