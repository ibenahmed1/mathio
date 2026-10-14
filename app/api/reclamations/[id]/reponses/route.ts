import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { ajouterReponse } from '@/lib/reclamations';

// Ajoute une réponse au fil d'une réclamation (back-office). Elle reste telle
// quelle ; refusée si la réclamation est fermée.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'moderateur', 'superviseur']);
    const { id } = await params;
    const body = await request.json();
    await ajouterReponse(id, session.sub, body.texte);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
