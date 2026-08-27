import { VueVentilation } from '@/components/admin/statistiques/VueVentilation';
import { filtrePeriode, getVentilationClient, resoudrePeriode } from '@/lib/statistiques';

export default async function StatistiqueClientPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode: brut } = await searchParams;
  const periode = resoudrePeriode(brut);
  const lignes = await getVentilationClient(filtrePeriode(periode));

  return (
    <VueVentilation
      periode={periode}
      lignes={lignes}
      libelleColonne="Destinataire"
      libelleEntite="Destinataires"
      messageVide="Aucun colis sur cette période."
      note="Les destinataires sont regroupés par numéro de téléphone : deux colis au même numéro sont le même client, quelle que soit l'orthographe du nom."
    />
  );
}
