import { CarteStat } from '@/components/admin/statistiques/CarteStat';
import { TableauVentilation } from '@/components/admin/statistiques/TableauVentilation';
import {
  formatDirhams,
  formatNombre,
  formatTaux,
  tauxLivraison,
  type LigneVentilation,
  type Periode,
} from '@/lib/statistiques';

// Corps commun des quatre pages de ventilation (livreur, ville, zone, client).
// Chaque page ne garde que sa requête et ses libellés : c'est la seule chose
// qui les distingue réellement, et quatre copies de ce rendu auraient divergé
// dès la première retouche.
export function VueVentilation({
  periode,
  lignes,
  libelleColonne,
  libelleEntite,
  messageVide,
  note,
}: {
  periode: Periode;
  lignes: LigneVentilation[];
  libelleColonne: string;
  libelleEntite: string;
  messageVide: string;
  note?: string;
}) {
  const totaux = lignes.reduce(
    (acc, l) => ({
      total: acc.total + l.compteurs.total,
      livres: acc.livres + l.compteurs.livres,
      retournes: acc.retournes + l.compteurs.retournes,
      annules: acc.annules + l.compteurs.annules,
      enCours: acc.enCours + l.compteurs.enCours,
      cod: acc.cod + l.codEncaisse,
    }),
    { total: 0, livres: 0, retournes: 0, annules: 0, enCours: 0, cod: 0 }
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm opacity-60">
        Colis créés sur la période <span className="font-semibold">{periode.label.toLowerCase()}</span>, et ce
        qu&apos;ils sont devenus.
        {note && <span className="block text-xs opacity-80">{note}</span>}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CarteStat label={libelleEntite} valeur={formatNombre(lignes.length)} precision="sur la période" />
        <CarteStat label="Colis" valeur={formatNombre(totaux.total)} precision={`${formatNombre(totaux.enCours)} encore en cours`} />
        <CarteStat
          label="Taux de livraison"
          valeur={formatTaux(tauxLivraison({ ...totaux, total: totaux.total }))}
          precision={`${formatNombre(totaux.livres)} livrés / ${formatNombre(totaux.retournes)} retournés`}
        />
        <CarteStat label="COD encaissé" valeur={formatDirhams(totaux.cod)} precision="colis livrés uniquement" />
      </div>

      <TableauVentilation lignes={lignes} libelleColonne={libelleColonne} messageVide={messageVide} />
    </div>
  );
}
