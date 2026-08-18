import { ApiError } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
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
  const dateReceptionHubFrom = searchParams.get('dateReceptionHubFrom');
  const dateReceptionHubTo = searchParams.get('dateReceptionHubTo');
  // § Gestion de stock (/admin/stock/nouveaux, /admin/stock/prets) : filtres
  // propres au pipeline colis "stock" (Commande.enStock), cf. lib/hub-stock.ts.
  const enStockParam = searchParams.get('enStock');
  const sansBonPreparationParam = searchParams.get('sansBonPreparation');
  // Isolation des vues (bug rapporté : colis stock encore en préparation
  // polluant la liste globale /admin/commandes). Un colis enStock=true tant
  // qu'il n'a pas quitté le picking Hub (statut nouveau_colis ou
  // pret_pour_preparation) ne doit apparaître QUE dans /admin/stock/nouveaux
  // et /admin/stock/prets — jamais dans la liste back-office générique. Une
  // fois recu_au_hub/en_transit, il rejoint le pipeline générique et redevient
  // visible normalement. Opt-in (plutôt que par défaut dans buildCommandesWhere)
  // pour ne pas casser la recherche /admin/colis/suivi ni la vue marchand, qui
  // doivent pouvoir retrouver un colis stock même avant sa prise en charge Hub.
  const excludeEnPreparationStockParam = searchParams.get('excludeEnPreparationStock');

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
  // Utilisé par l'écran de scan Agent Hub (/admin/scan/reception) pour
  // retrouver "colis réceptionnés aujourd'hui" après un rechargement de page
  // — même principe que dateCollecteFrom/To ci-dessus pour le ramasseur.
  if (dateReceptionHubFrom || dateReceptionHubTo) {
    where.dateReceptionHub = {
      ...(dateReceptionHubFrom && { gte: new Date(dateReceptionHubFrom) }),
      ...(dateReceptionHubTo && { lte: new Date(dateReceptionHubTo) }),
    };
  }
  if (search) {
    where.OR = [
      { codeSuivi: { contains: search, mode: 'insensitive' } },
      { clientNom: { contains: search, mode: 'insensitive' } },
      { clientTelephone: { contains: search } },
    ];
  }
  if (enStockParam != null) {
    where.enStock = enStockParam === 'true';
  }
  if (sansBonPreparationParam === 'true') {
    where.bonPreparationId = null;
  }
  if (excludeEnPreparationStockParam === 'true') {
    where.NOT = {
      ...(where.NOT as Prisma.CommandeWhereInput | undefined),
      enStock: true,
      statut: { in: ['nouveau_colis', 'pret_pour_preparation'] },
    };
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
    const livreur = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { hubId: true },
    });
    if (!livreur?.hubId) throw new ApiError(403, "Votre compte n'est rattaché à aucun hub");
    where.livreurId = session.sub;
    where.hubActuelId = livreur.hubId;
  } else if (session.role === 'agent_hub') {
    const agent = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { hubId: true },
    });
    if (!agent?.hubId) throw new ApiError(403, "Votre compte n'est rattaché à aucun hub");
    where.hubActuelId = agent.hubId;
  }

  return where;
}
