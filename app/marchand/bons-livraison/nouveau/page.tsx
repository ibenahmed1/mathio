import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession, roleMatches } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { NouveauBonLivraisonClient } from './NouveauBonLivraisonClient';
import type { Commande } from '@/lib/types';

export default async function AjouterBonLivraisonPage() {
  const session = await getPageSession('marchand');
  if (!session || !roleMatches(session, ['marchand'])) {
    redirect('/login');
  }

  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) {
    redirect('/marchand');
  }

  const colisEligibles = await prisma.commande.findMany({
    where: { marchandId: marchand.id, statut: 'nouveau_colis', bonLivraisonId: null, enStock: false },
    orderBy: { dateCreation: 'desc' },
  });

  const colis: Pick<Commande, 'id' | 'codeSuivi' | 'clientNom' | 'ville' | 'montantCod' | 'dateCreation'>[] =
    colisEligibles.map((c) => ({
      id: c.id,
      codeSuivi: c.codeSuivi,
      clientNom: c.clientNom,
      ville: c.ville,
      montantCod: c.montantCod.toString(),
      dateCreation: c.dateCreation.toISOString(),
    }));

  return <NouveauBonLivraisonClient colisInitial={colis} />;
}
