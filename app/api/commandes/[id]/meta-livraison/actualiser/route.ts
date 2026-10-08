import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { actualiserColisMeta } from '@/lib/suivi-meta-livraison';

// § Meta Livraison — interroge leur suivi et applique ce qu'il dit
// (lib/suivi-meta-livraison.ts). Leur webhook est le canal principal ; ce
// bouton sert de rattrapage et à confirmer une remise restée « à confirmer ».
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json(await actualiserColisMeta(id));
  } catch (error) {
    return jsonError(error);
  }
}
