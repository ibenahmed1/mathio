import { VueVentilation } from '@/components/admin/statistiques/VueVentilation';
import { filtrePeriode, getVentilationHub, resoudrePeriode } from '@/lib/statistiques';

export default async function StatistiqueZonePage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode: brut } = await searchParams;
  const periode = resoudrePeriode(brut);
  const lignes = await getVentilationHub(filtrePeriode(periode));

  return (
    <VueVentilation
      periode={periode}
      lignes={lignes}
      libelleColonne="Zone (hub)"
      libelleEntite="Zones actives"
      messageVide="Aucun colis sur cette période."
      note="La zone est le hub où le colis a été réceptionné. Un colis jamais scanné au quai apparaît sous « Jamais passé par un hub »."
    />
  );
}
