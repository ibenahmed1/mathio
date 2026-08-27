import { CarteStat } from '@/components/admin/statistiques/CarteStat';
import { CourbeEvolution } from '@/components/admin/statistiques/CourbeEvolution';
import { RepartitionStatuts } from '@/components/admin/statistiques/RepartitionStatuts';
import {
  filtrePeriode,
  formatDirhams,
  formatNombre,
  formatTaux,
  getCodEncaisse,
  getCompteurs,
  getEvolution,
  getRepartitionStatuts,
  periodePrecedenteEquivalente,
  resoudrePeriode,
  tauxAnnulation,
  tauxLivraison,
  tauxRetour,
  variation,
} from '@/lib/statistiques';

export default async function StatistiqueToutPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode: brut } = await searchParams;
  const periode = resoudrePeriode(brut);
  const precedente = periodePrecedenteEquivalente(periode);
  const where = filtrePeriode(periode);

  // La période précédente n'est chargée que si elle existe (« depuis le début »
  // n'en a pas) : deux requêtes de plus pour rien sur la vue la plus large.
  const [compteurs, cod, evolution, repartition, compteursPrec, codPrec] = await Promise.all([
    getCompteurs(where),
    getCodEncaisse(where),
    getEvolution(periode),
    getRepartitionStatuts(where),
    precedente ? getCompteurs(filtrePeriode(precedente)) : Promise.resolve(null),
    precedente ? getCodEncaisse(filtrePeriode(precedente)) : Promise.resolve(null),
  ]);

  const tauxActuel = tauxLivraison(compteurs);
  const tauxPrec = compteursPrec ? tauxLivraison(compteursPrec) : null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm opacity-60">
        Colis créés sur la période <span className="font-semibold">{periode.label.toLowerCase()}</span>, et ce
        qu&apos;ils sont devenus.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <CarteStat
          label="Colis pris en charge"
          valeur={formatNombre(compteurs.total)}
          variation={compteursPrec ? variation(compteurs.total, compteursPrec.total) : null}
        />
        <CarteStat
          label="Taux de livraison"
          valeur={formatTaux(tauxActuel)}
          variation={tauxActuel !== null && tauxPrec !== null ? variation(tauxActuel, tauxPrec) : null}
        />
        <CarteStat
          label="Taux de retour"
          valeur={formatTaux(tauxRetour(compteurs))}
          hausseEstBonne={false}
          precision={`${formatNombre(compteurs.retournes)} colis retournés`}
        />
        <CarteStat
          label="Taux d'annulation"
          valeur={formatTaux(tauxAnnulation(compteurs))}
          hausseEstBonne={false}
          precision={`${formatNombre(compteurs.annules)} colis annulés`}
        />
        <CarteStat
          label="COD encaissé"
          valeur={formatDirhams(cod)}
          variation={codPrec !== null ? variation(cod, codPrec) : null}
        />
      </div>

      <div className="dashboard-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide opacity-70">
          Évolution des prises en charge et de leur devenir
        </h2>
        <CourbeEvolution data={evolution} />
      </div>

      <div className="dashboard-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide opacity-70">
          Où en sont les colis de la période
        </h2>
        <RepartitionStatuts lignes={repartition} />
      </div>
    </div>
  );
}
