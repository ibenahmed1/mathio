import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

async function getOwnMarchand(utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand;
}

export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    return NextResponse.json(marchand);
  } catch (error) {
    return jsonError(error);
  }
}

// RF-24 : configuration du profil boutique et du créneau de ramassage récurrent.
export async function PATCH(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const body = await request.json();

    const data: {
      nomBoutique?: string;
      ville?: string | null;
      raisonSociale?: string | null;
      iceRc?: string | null;
      cin?: string | null;
      siteWeb?: string | null;
      adresse?: string | null;
      nomBanque?: string | null;
      rib?: string | null;
      ribPhotoUrl?: string | null;
      registreCommerce?: string | null;
      villeRamassage?: string | null;
      ramassageRecurrentActif?: boolean;
      ramassageJours?: string | null;
      ramassageCreneauHoraire?: string | null;
    } = {};

    if (typeof body.nomBoutique === 'string' && body.nomBoutique.trim()) data.nomBoutique = body.nomBoutique.trim();
    if (typeof body.ville === 'string') data.ville = body.ville.trim() || null;
    if (typeof body.raisonSociale === 'string') data.raisonSociale = body.raisonSociale.trim() || null;
    if (typeof body.iceRc === 'string') data.iceRc = body.iceRc.trim() || null;
    if (typeof body.cin === 'string') data.cin = body.cin.trim() || null;
    if (typeof body.siteWeb === 'string') data.siteWeb = body.siteWeb.trim() || null;
    if (typeof body.adresse === 'string') data.adresse = body.adresse.trim() || null;
    if (typeof body.nomBanque === 'string') data.nomBanque = body.nomBanque.trim() || null;
    if (typeof body.rib === 'string') data.rib = body.rib.trim() || null;
    if (typeof body.ribPhotoUrl === 'string' && body.ribPhotoUrl.trim()) data.ribPhotoUrl = body.ribPhotoUrl.trim();
    if (typeof body.registreCommerce === 'string') data.registreCommerce = body.registreCommerce.trim() || null;
    if (typeof body.villeRamassage === 'string') data.villeRamassage = body.villeRamassage.trim() || null;
    if (typeof body.ramassageRecurrentActif === 'boolean') data.ramassageRecurrentActif = body.ramassageRecurrentActif;
    if (typeof body.ramassageJours === 'string') data.ramassageJours = body.ramassageJours.trim() || null;
    if (typeof body.ramassageCreneauHoraire === 'string') {
      data.ramassageCreneauHoraire = body.ramassageCreneauHoraire.trim() || null;
    }

    const updated = await prisma.marchand.update({ where: { id: marchand.id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
