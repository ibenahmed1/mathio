import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { chargerResolveurTransporteur, cleRoutage, refusTransporteur, type TransporteurPrevu } from '@/lib/hub-envoi';
import { nextBonEnvoiNumero } from '@/lib/codes';
import { STATUTS_TERMINAUX } from '@/lib/statuts';
import { tarifsAchatParVille } from '@/lib/bon-envoi-prestataire';
import { refusShipehNonScanne, statutEntreeBonEnvoi, suitCircuitShipeh } from '@/lib/circuit-shipeh';
import { NOM_PRESTATAIRE_POWER } from '@/lib/remise-power-delivery';

// § Bon d'envoi EXCEPTIONNEL (décision du 16/10/2026) — débloquer une
// situation. Les colis scannés entrent dans le bon du transporteur choisi même
// quand le routage les envoie ailleurs (§ refusTransporteur) ou que sa grille
// ne connaît pas leur ville : leur coût d'achat reste alors NULL — jamais un
// tarif inventé (§ lib/reglements-transporteurs.ts lit la grille du
// transporteur du bon, ville par ville).
//
// Ce qui reste refusé n'est pas une règle de routage mais une erreur de
// manipulation : colis inconnu, déjà dans un bon, en tournée, clos, ou colis
// Shipeh pas encore scanné au Hub Central (c'est ce scan qui sort le produit
// du stock). Chaque règle contournée est écrite dans l'historique du colis.
//
// Rien n'est transmis par API, sauf à Power Delivery (leur API accepte toutes
// leurs villes) : la remise est lancée à la création, par l'appelant.

export interface ColisExceptionnelDto {
  id: string;
  codeSuivi: string;
  ville: string;
  statut: string;
  marchandNom: string | null;
  // Tarif d'achat chez le transporteur choisi, null = hors de sa grille.
  tarifAchat: number | null;
  // Règles contournées, en clair : vide = le colis serait passé normalement.
  contournements: string[];
}

const selectColis = {
  id: true,
  codeSuivi: true,
  ville: true,
  villeId: true,
  statut: true,
  source: true,
  enStock: true,
  hubActuelId: true,
  bonEnvoiId: true,
  marchand: { select: { nomBoutique: true } },
  bonDistribution: { select: { numero: true, statut: true } },
} as const;

type ColisLu = NonNullable<Awaited<ReturnType<typeof lireColis>>>;

function lireColis(where: { id: string } | { codeSuivi: string }) {
  return prisma.commande.findUnique({ where, select: selectColis });
}

// Les seuls refus d'un bon exceptionnel. `null` = le colis peut y entrer.
function refusBloquant(c: ColisLu): string | null {
  if (c.bonEnvoiId) return `${c.codeSuivi} est déjà dans un autre Bon d'Envoi.`;
  if (c.bonDistribution && c.bonDistribution.statut !== 'cloture') {
    return `${c.codeSuivi} est en tournée (${c.bonDistribution.numero}).`;
  }
  if (STATUTS_TERMINAUX.includes(c.statut)) return `${c.codeSuivi} est « ${c.statut} » : colis clos.`;
  return refusShipehNonScanne(c);
}

function contournementsDe(
  c: ColisLu,
  prevu: TransporteurPrevu | null,
  prestataire: { id: string; nom: string },
  tarifAchat: number | null
): string[] {
  const liste: string[] = [];
  if (refusTransporteur(c, prevu, prestataire)) {
    liste.push(
      prevu?.prestataireNom
        ? `prévu chez ${prevu.prestataireNom}${prevu.hubNom ? ` (${prevu.hubNom})` : ''}`
        : 'ville desservie par aucun transporteur'
    );
  }
  if (tarifAchat === null) liste.push(`ville hors grille de ${prestataire.nom}, sans tarif`);
  return liste;
}

async function prestataireActif(prestataireId: string) {
  const p = await prisma.prestataire.findUnique({
    where: { id: prestataireId },
    select: { id: true, nom: true, compteLivreurId: true },
  });
  if (!p) throw new ApiError(400, 'Transporteur introuvable');
  return p;
}

// Scan d'un colis : résout le code et dit ce qui sera contourné. Ne mute rien.
export async function verifierColisExceptionnel(codeSuivi: string, prestataireId: string): Promise<ColisExceptionnelDto> {
  const prestataire = await prestataireActif(prestataireId);
  const colis = await lireColis({ codeSuivi });
  if (!colis) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
  const refus = refusBloquant(colis);
  if (refus) throw new ApiError(409, refus);

  const [resoudre, tarifs] = await Promise.all([chargerResolveurTransporteur(), tarifsAchatParVille(prestataire.id)]);
  const tarifAchat = tarifs.get(cleRoutage(colis.ville)) ?? null;
  return {
    id: colis.id,
    codeSuivi: colis.codeSuivi,
    ville: colis.ville,
    statut: colis.statut,
    marchandNom: colis.marchand?.nomBoutique ?? null,
    tarifAchat,
    contournements: contournementsDe(colis, resoudre(colis), prestataire, tarifAchat),
  };
}

export interface BonExceptionnelCree {
  id: string;
  numero: string;
  nbColis: number;
  power: boolean;
}

export async function creerBonEnvoiExceptionnel(params: {
  prestataireId: string;
  colisIds: string[];
  motif: string;
  auteurId: string;
}): Promise<BonExceptionnelCree> {
  const motif = params.motif.trim();
  if (motif.length < 3) throw new ApiError(400, 'Le motif est obligatoire');
  const prestataire = await prestataireActif(params.prestataireId);

  // Revalidation serveur : l'écran a pu vieillir entre le scan et le clic.
  const colis = (await Promise.all(params.colisIds.map((id) => lireColis({ id })))).filter(
    (c): c is ColisLu => Boolean(c)
  );
  if (colis.length !== params.colisIds.length) throw new ApiError(409, 'Un ou plusieurs colis sont introuvables');
  const refus = colis.map(refusBloquant).filter((m): m is string => m !== null);
  if (refus.length > 0) throw new ApiError(409, refus.slice(0, 5).join(' · '));

  const [resoudre, tarifs] = await Promise.all([chargerResolveurTransporteur(), tarifsAchatParVille(prestataire.id)]);

  const bon = await prisma.$transaction(async (tx) => {
    const numero = await nextBonEnvoiNumero(tx);
    const cree = await tx.bonEnvoi.create({
      data: {
        numero,
        prestataireId: prestataire.id,
        nbColis: colis.length,
        exceptionnel: true,
        motifExceptionnel: motif,
        creeParId: params.auteurId,
      },
      select: { id: true, numero: true, nbColis: true },
    });

    // Même écriture que le bon d'un transporteur (lib/bon-envoi-prestataire.ts) :
    // un colis Shipeh attend sa remise, les autres passent en transit.
    // `bonEnvoiId: null` dans le filtre : un colis pris entre-temps par un autre
    // bon n'est pas volé, le compte ci-dessous le détecte.
    const shipeh = colis.filter(suitCircuitShipeh).map((c) => c.id);
    const autres = colis.filter((c) => !suitCircuitShipeh(c)).map((c) => c.id);
    const a = await tx.commande.updateMany({
      where: { id: { in: shipeh }, bonEnvoiId: null },
      data: { bonEnvoiId: cree.id, livreurId: prestataire.compteLivreurId },
    });
    const b = await tx.commande.updateMany({
      where: { id: { in: autres }, bonEnvoiId: null },
      data: { bonEnvoiId: cree.id, statut: 'en_transit', livreurId: prestataire.compteLivreurId },
    });
    if (a.count + b.count !== colis.length) {
      throw new ApiError(409, "Un colis vient d'être pris dans un autre Bon d'Envoi : rescannez");
    }

    await tx.historiqueStatutCommande.createMany({
      data: colis.map((c) => {
        const tarif = tarifs.get(cleRoutage(c.ville)) ?? null;
        const contournes = contournementsDe(c, resoudre(c), prestataire, tarif);
        return {
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: statutEntreeBonEnvoi(c),
          utilisateurId: params.auteurId,
          hubId: c.hubActuelId,
          note:
            `BE exceptionnel ${numero} → ${prestataire.nom}` +
            (contournes.length ? ` — règles contournées : ${contournes.join(', ')}` : '') +
            ` — motif : ${motif}`,
        };
      }),
    });
    return cree;
  });

  return { ...bon, power: prestataire.nom === NOM_PRESTATAIRE_POWER };
}

// Garde des remises par API autres que Power : un bon exceptionnel ne leur
// transmet rien (décision du 16/10/2026).
export async function refuserRemiseApiSiExceptionnel(bonEnvoiId: string, transporteur: string): Promise<void> {
  const bon = await prisma.bonEnvoi.findUnique({ where: { id: bonEnvoiId }, select: { exceptionnel: true } });
  if (bon?.exceptionnel) {
    throw new ApiError(409, `Bon exceptionnel : rien n'est transmis à ${transporteur} par API. Remettez-le par l'Excel.`);
  }
}
