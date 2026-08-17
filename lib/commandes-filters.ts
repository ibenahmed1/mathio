import { ApiError } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { STATUTS_COMMANDE } from '@/lib/statuts';
import type { Prisma } from '@/app/generated/prisma/client';
import type { EtatPaiement, StatutCommande } from '@/app/generated/prisma/enums';
import type { SessionPayload } from '@/lib/auth';

// Construit le `where` Prisma des commandes à partir des query params partagés
// entre la liste paginée (GET /api/commandes) et l'export Excel — évite que
// les deux routes divergent sur l'interprétation d'un même filtre.
export async function buildCommandesWhere(
  searchParams: URLSearchParams,
  session: SessionPayload,
): Promise<Prisma.CommandeWhereInput> {
  const statutParam = searchParams.get('statut');
  const etatPaiementParam = searchParams.get('etatPaiement');
  const ville = searchParams.get('ville');
  const search = searchParams.get('search');
  const livreurId = searchParams.get('livreurId');
  const ramasseurId = searchParams.get('ramasseurId');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const dateCollecteFrom = searchParams.get('dateCollecteFrom');
  const dateCollecteTo = searchParams.get('dateCollecteTo');

  const where: Prisma.CommandeWhereInput = {};

  if (statutParam) {
    const statuts = statutParam.split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of statuts) {
      if (!STATUTS_COMMANDE.includes(s as StatutCommande)) {
        throw new ApiError(400, `Statut invalide : ${s}`);
      }
    }
    where.statut = statuts.length > 1 ? { in: statuts as StatutCommande[] } : (statuts[0] as StatutCommande);
  }
  if (etatPaiementParam) {
    if (!['non_paye', 'facture', 'paye', 'rembourse'].includes(etatPaiementParam)) {
      throw new ApiError(400, `État de paiement invalide : ${etatPaiementParam}`);
    }
    where.etatPaiement = etatPaiementParam as EtatPaiement;
  }
  if (ville) {
    where.ville = { equals: ville, mode: 'insensitive' };
  }
  if (livreurId) {
    where.livreurId = livreurId;
  }
  if (ramasseurId) {
    where.ramasseurId = ramasseurId;
  }
  if (dateFrom || dateTo) {
    where.dateCreation = {
      ...(dateFrom && { gte: new Date(dateFrom) }),
      ...(dateTo && { lte: new Date(dateTo) }),
    };
  }
  // Utilisé par l'écran de scan ramasseur pour retrouver "mes colis scannés
  // aujourd'hui" après un rechargement de page (le tableau y vit sinon
  // uniquement en mémoire côté client).
  if (dateCollecteFrom || dateCollecteTo) {
    where.dateCollecte = {
      ...(dateCollecteFrom && { gte: new Date(dateCollecteFrom) }),
      ...(dateCollecteTo && { lte: new Date(dateCollecteTo) }),
    };
  }
  if (search) {
    where.OR = [
      { codeSuivi: { contains: search, mode: 'insensitive' } },
      { clientNom: { contains: search, mode: 'insensitive' } },
      { clientTelephone: { contains: search } },
    ];
  }

  // RG-07 / RNF-02 : cloisonnement des données par rôle. Pour ramasseur/livreur,
  // on impose l'auto-cloisonnement côté serveur (écrase tout ramasseurId/livreurId
  // fourni en query string) : avant ce correctif, ces rôles pouvaient interroger
  // les colis de n'importe qui, le filtre n'étant qu'une convention côté client.
  if (session.role === 'marchand') {
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
    where.marchandId = marchand.id;
  } else if (session.role === 'ramasseur') {
    where.ramasseurId = session.sub;
  } else if (session.role === 'livreur') {
    where.livreurId = session.sub;
  }

  return where;
}
