import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { syntheseParTransporteur } from '@/lib/reglements-transporteurs';

// § Règlements transporteurs — synthèse par transporteur, et les villes qu'il
// dessert sans tarif dans sa grille (toutes doivent en avoir un : sans tarif,
// on ne sait pas ce qu'il garde, donc ce qu'il doit nous reverser).
export async function GET() {
  try {
    await requireUser(['admin']);
    const [transporteurs, villes] = await Promise.all([
      syntheseParTransporteur(),
      prisma.ville.findMany({
        where: { hub: { prestataireId: { not: null } } },
        select: { id: true, nom: true, hub: { select: { prestataireId: true, prestataire: { select: { nom: true } } } } },
        orderBy: { nom: 'asc' },
      }),
    ]);
    const tarifees = new Set(
      (await prisma.tarifPrestataireVille.findMany({ select: { prestataireId: true, villeId: true } })).map(
        (t) => `${t.prestataireId}:${t.villeId}`
      )
    );
    const sansTarif = new Map<string, { transporteur: string; villes: string[] }>();
    for (const v of villes) {
      const pid = v.hub!.prestataireId!;
      if (tarifees.has(`${pid}:${v.id}`)) continue;
      const entree = sansTarif.get(pid) ?? { transporteur: v.hub!.prestataire!.nom, villes: [] };
      entree.villes.push(v.nom);
      sansTarif.set(pid, entree);
    }
    return NextResponse.json({ transporteurs, villesSansTarif: [...sansTarif.values()] });
  } catch (error) {
    return jsonError(error);
  }
}
