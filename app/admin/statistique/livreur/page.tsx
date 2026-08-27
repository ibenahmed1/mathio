import { VueVentilation } from '@/components/admin/statistiques/VueVentilation';
import { filtrePeriode, getVentilationLivreur, resoudrePeriode } from '@/lib/statistiques';

export default async function StatistiqueLivreurPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode: brut } = await searchParams;
  const periode = resoudrePeriode(brut);
  const lignes = await getVentilationLivreur(filtrePeriode(periode));

  return (
    <VueVentilation
      periode={periode}
      lignes={lignes}
      libelleColonne="Livreur"
      libelleEntite="Livreurs actifs"
      messageVide="Aucun colis affecté à un livreur sur cette période."
      note="Seuls les colis affectés à un livreur apparaissent ici — un colis jamais parti en tournée n'est imputable à personne."
    />
  );
}
