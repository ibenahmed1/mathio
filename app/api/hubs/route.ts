import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { messageConflitHub } from '@/lib/prestataires';

// Référentiel géographique plat (Hub ↔ Ville) : gestion admin uniquement.
export async function GET() {
  try {
    await requireUser(['admin']);

    const hubs = await prisma.hub.findMany({
      orderBy: { nom: 'asc' },
      include: {
        // Non nul = agence sous-traitée (cf. Hub.prestataireId) : c'est ce qui
        // distingue une agence d'un hub interne côté UI.
        prestataire: { select: { id: true, nom: true, actif: true } },
        villes: {
          orderBy: { nom: 'asc' },
          include: {
            // Toute la grille de la ville, pas seulement celle de l'agence qui
            // la couvre : une ville livrée en interne peut être tarifée par un
            // prestataire, et c'est justement la comparaison qui intéresse.
            tarifsPrestataires: {
              include: { prestataire: { select: { id: true, nom: true } } },
            },
          },
        },
      },
    });

    const hubsAvecCompteur = await Promise.all(
      hubs.map(async (hub) => {
        const nbColisDepot = await prisma.commande.count({
          where: { hubActuelId: hub.id, statut: 'recu_au_hub' },
        });
        return {
          ...hub,
          villes: hub.villes.map((ville) => ({
            ...ville,
            // Tarif applicable ici et maintenant : celui du prestataire qui
            // exploite le hub couvrant la ville. Null sur un hub interne — il
            // n'y a alors pas de coût de sous-traitance, c'est le tarif du
            // livreur (TarifLivreurVille) qui s'applique.
            tarifPrestataire:
              hub.prestataireId
                ? (ville.tarifsPrestataires.find((t) => t.prestataireId === hub.prestataireId)?.tarifLivraison ?? null)
                : null,
            // Souvent absent : les grilles fournisseurs ne chiffrent pas
            // toujours le retour. Tant qu'il manque, le coût d'un colis
            // retourné dans cette ville reste inconnu en facturation.
            tarifPrestataireRetour:
              hub.prestataireId
                ? (ville.tarifsPrestataires.find((t) => t.prestataireId === hub.prestataireId)?.tarifRetour ?? null)
                : null,
          })),
          nbColisDepot,
        };
      })
    );

    return NextResponse.json({ data: hubsAvecCompteur });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const ville = typeof body.ville === 'string' ? body.ville.trim() : '';
    const adresse = typeof body.adresse === 'string' && body.adresse.trim() ? body.adresse.trim() : null;
    const telephone = typeof body.telephone === 'string' && body.telephone.trim() ? body.telephone.trim() : null;
    const isCentral = body.isCentral === true;
    // Vide/absent = hub interne (nos livreurs). Renseigné = agence d'un
    // prestataire, cf. Hub.prestataireId.
    const prestataireId = typeof body.prestataireId === 'string' && body.prestataireId.trim() ? body.prestataireId.trim() : null;

    if (!nom || !ville) {
      throw new ApiError(400, 'nom et ville sont requis');
    }
    if (prestataireId && !(await prisma.prestataire.findUnique({ where: { id: prestataireId } }))) {
      throw new ApiError(404, 'Prestataire introuvable');
    }

    try {
      const hub = await prisma.hub.create({ data: { nom, ville, adresse, telephone, isCentral, prestataireId } });
      return NextResponse.json(hub, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, messageConflitHub(error));
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
