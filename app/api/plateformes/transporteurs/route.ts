import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { getClientIp } from '@/lib/rate-limit';
import { creerTransporteur, listerTransporteursDisponibles } from '@/lib/plateformes';

// GET /api/plateformes/transporteurs — les transporteurs qui peuvent encore
// recevoir un compte machine, pour le formulaire de création (§ /admin/integrations).
//
// Rangé sous `/api/plateformes/**` et non sous `/api/prestataires/**`, ce qui
// n'est pas un détail de classement : le premier est gouverné par
// `integrations:manage`, le second par `hubs:manage`. Cet écran ne doit exiger
// qu'une permission, la sienne — sinon ouvrir la gestion des intégrations à un
// profil obligerait à lui ouvrir aussi le référentiel logistique.
//
// Aucune collision avec `[id]` : ce segment-là est un UUID (detaillerPlateforme
// cherche sur la clé primaire, pas sur le code), et un UUID ne vaut jamais
// « transporteurs ».
export async function GET() {
  try {
    await requirePermission('integrations:manage');
    return NextResponse.json(await listerTransporteursDisponibles());
  } catch (error) {
    return jsonError(error);
  }
}

// POST /api/plateformes/transporteurs — ajoute au référentiel un transporteur
// qui n'y figure pas encore, pour ne pas faire quitter l'écran au milieu d'une
// création de compte machine.
//
// Volontairement réduit au NOM. Les agences, les villes couvertes et les
// tarifs sont l'affaire du référentiel de sous-traitance (§ SOUS_TRAITANCE.md,
// `npm run db:reseau`) et se saisissent sous /admin/prestataires : les
// proposer ici ferait de cet écran un second endroit où administrer le réseau,
// donc un second endroit à tenir à jour.
export async function POST(request: Request) {
  try {
    const session = await requirePermission('integrations:manage');
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    if (!nom) throw new ApiError(400, 'nom est requis');

    const cree = await creerTransporteur(nom);

    // Créer une entrée du référentiel depuis un écran gouverné par une AUTRE
    // permission que la sienne mérite sa trace : c'est la contrepartie assumée
    // de n'exiger ici que `integrations:manage`.
    await prisma.auditLog.create({
      data: {
        adminId: session.sub,
        action: 'prestataire.creation',
        cibleType: 'prestataire',
        cibleId: cree.id,
        adresseIp: getClientIp(request),
      },
    });

    return NextResponse.json(cree, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
