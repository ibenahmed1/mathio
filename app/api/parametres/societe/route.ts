import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getParametresSociete, ID_SOCIETE } from '@/lib/societe';

// Lecture ouverte à tout compte du back-office : ces informations figurent de
// toute façon sur chaque document imprimé, il n'y a rien à protéger. L'ÉCRITURE
// est réservée à l'admin — modifier la raison sociale ou le RIB affiché change
// tous les documents sortants, passés comme futurs.
const ROLES_ECRITURE = ['admin'] as const;

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await getParametresSociete());
  } catch (error) {
    return jsonError(error);
  }
}

// Champ vide = champ effacé (null), et non « champ inchangé » : le formulaire
// envoie toujours l'objet complet, donc un utilisateur qui vide l'adresse
// attend qu'elle disparaisse des documents.
function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  return propre.length > 0 ? propre : null;
}

export async function PUT(request: Request) {
  try {
    await requireUser([...ROLES_ECRITURE]);
    const body = await request.json();

    const raisonSociale = typeof body.raisonSociale === 'string' ? body.raisonSociale.trim() : '';
    if (!raisonSociale) throw new ApiError(400, 'La raison sociale est obligatoire');

    const donnees = {
      raisonSociale,
      adresse: texteOuNull(body.adresse),
      telephone: texteOuNull(body.telephone),
      email: texteOuNull(body.email),
      siteWeb: texteOuNull(body.siteWeb),
      logoUrl: texteOuNull(body.logoUrl),
    };

    // Upsert plutôt qu'update : la ligne est posée par la migration, mais une
    // base restaurée sans elle doit pouvoir être renseignée depuis l'écran
    // plutôt que rejouer un INSERT à la main.
    const majour = await prisma.parametresSociete.upsert({
      where: { id: ID_SOCIETE },
      create: { id: ID_SOCIETE, ...donnees },
      update: donnees,
    });

    return NextResponse.json(majour);
  } catch (error) {
    return jsonError(error);
  }
}
