import { VueVentilation } from '@/components/admin/statistiques/VueVentilation';
import { filtrePeriode, getVentilationVille, resoudrePeriode } from '@/lib/statistiques';

export default async function StatistiqueVillePage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode: brut } = await searchParams;
  const periode = resoudrePeriode(brut);
  const lignes = await getVentilationVille(filtrePeriode(periode));

  return (
    <VueVentilation
      periode={periode}
      lignes={lignes}
      libelleColonne="Ville"
      libelleEntite="Villes desservies"
      messageVide="Aucun colis sur cette période."
      note="Les villes hors référentiel sont regroupées sur le texte saisi — les rattacher au référentiel fiabilise ce classement."
    />
  );
}
