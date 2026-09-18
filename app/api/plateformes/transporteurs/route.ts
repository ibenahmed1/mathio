import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { listerTransporteursDisponibles } from '@/lib/plateformes';

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
