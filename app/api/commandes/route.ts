import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { checkBlacklist } from '@/lib/blacklist';
import { nextCodeSuivi } from '@/lib/codes';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { buildCommandesWhere } from '@/lib/commandes-filters';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser();
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const where = await buildCommandesWhere(searchParams, session);

    const [data, total] = await Promise.all([
      prisma.commande.findMany({
        where,
        include: {
          marchand: { select: { nomBoutique: true } },
          livreur: { select: { id: true, nomComplet: true } },
          marchandise: { select: { id: true, nom: true, prix: true } },
          colisARemplacer: { select: { id: true, codeSuivi: true } },
        },
        orderBy: { dateCreation: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.commande.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireUser(['marchand', 'admin']);
    const body = await request.json();

    const clientNom = typeof body.clientNom === 'string' ? body.clientNom.trim() : '';
    const clientTelephone = typeof body.clientTelephone === 'string' ? body.clientTelephone.trim() : '';
    const ville = typeof body.ville === 'string' ? body.ville.trim() : '';
    const adresse = typeof body.adresse === 'string' ? body.adresse.trim() : '';
    const quantite = Number.isInteger(Number(body.quantite)) && Number(body.quantite) > 0 ? Number(body.quantite) : 1;

    if (!clientNom || !clientTelephone || !ville || !adresse) {
      throw new ApiError(400, 'client_nom, client_telephone, ville et adresse sont requis');
    }

    let marchandId: string;
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
      marchandId = marchand.id;
    } else {
      if (typeof body.marchandId !== 'string' || !body.marchandId) {
        throw new ApiError(400, 'marchandId requis pour une création par un administrateur');
      }
      const marchand = await prisma.marchand.findUnique({ where: { id: body.marchandId } });
      if (!marchand) throw new ApiError(404, 'Marchand introuvable');
      marchandId = marchand.id;
    }

    // Marchandise du catalogue du marchand (dropdown) : optionnelle, mais si
    // fournie elle doit appartenir au même marchand — sinon un marchand
    // pourrait référencer le catalogue d'un concurrent.
    let marchandiseId: string | null = null;
    let marchandisePrix: number | null = null;
    let produitDescription = typeof body.produitDescription === 'string' ? body.produitDescription.trim() || null : null;
    if (typeof body.marchandiseId === 'string' && body.marchandiseId) {
      const marchandise = await prisma.marchandise.findUnique({ where: { id: body.marchandiseId } });
      if (!marchandise || marchandise.marchandId !== marchandId) {
        throw new ApiError(400, 'marchandiseId invalide pour ce marchand');
      }
      marchandiseId = marchandise.id;
      marchandisePrix = Number(marchandise.prix);
      if (!produitDescription) produitDescription = marchandise.nom;
    }

    // Prix (montant COD) : saisi manuellement, ou par défaut prix de la
    // marchandise × quantité si une marchandise du catalogue est sélectionnée
    // — reste un champ toujours modifiable côté formulaire, ceci n'est qu'un
    // filet pour les appels API qui n'enverraient pas montant_cod.
    let montantCod = Number(body.montantCod);
    if (!Number.isFinite(montantCod) || montantCod <= 0) {
      montantCod = marchandisePrix != null ? marchandisePrix * quantite : NaN;
    }
    if (!Number.isFinite(montantCod) || montantCod <= 0) {
      throw new ApiError(400, 'montant_cod (>0) est requis, ou une marchandise du catalogue avec un prix');
    }

    // Colis à remplacer (échange) : accepte soit l'id interne, soit le code
    // de suivi saisi par le marchand — toujours vérifié dans le périmètre du marchand.
    let colisARemplacerId: string | null = null;
    if (typeof body.colisARemplacerId === 'string' && body.colisARemplacerId) {
      const cible = await prisma.commande.findUnique({ where: { id: body.colisARemplacerId } });
      if (!cible || cible.marchandId !== marchandId) {
        throw new ApiError(400, 'colisARemplacerId invalide pour ce marchand');
      }
      colisARemplacerId = cible.id;
    } else if (typeof body.colisARemplacerCode === 'string' && body.colisARemplacerCode.trim()) {
      const code = body.colisARemplacerCode.trim();
      const cible = await prisma.commande.findUnique({ where: { codeSuivi: code } });
      if (!cible || cible.marchandId !== marchandId) {
        throw new ApiError(400, `Colis à remplacer introuvable pour le code ${code}`);
      }
      colisARemplacerId = cible.id;
    }

    // RG-08 : vérification automatique de la liste noire à la création.
    const aRisque = await checkBlacklist({ telephone: clientTelephone, nom: clientNom, adresse });

    const codeSuivi = await nextCodeSuivi();

    const commande = await prisma.$transaction(async (tx) => {
      const created = await tx.commande.create({
        data: {
          codeSuivi,
          marchandId,
          clientNom,
          clientTelephone,
          ville,
          adresse,
          codePostal: typeof body.codePostal === 'string' ? body.codePostal : null,
          produitDescription,
          marchandiseId,
          quantite,
          poidsKg: body.poidsKg != null ? Number(body.poidsKg) : null,
          montantCod,
          notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
          colisARemplacerId,
          ouvrir: Boolean(body.ouvrir),
          fragile: Boolean(body.fragile),
          aRemplacer: Boolean(body.aRemplacer),
          enStock: Boolean(body.enStock),
          statut: 'nouveau_colis',
          aRisque,
          source: 'manuel',
        },
      });

      // RG-10 : historisation de chaque changement de statut, y compris l'état initial.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: created.id,
          ancienStatut: null,
          nouveauStatut: 'nouveau_colis',
          utilisateurId: session.sub,
        },
      });

      return created;
    });

    return NextResponse.json(commande, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
