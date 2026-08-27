import {
  formatDirhams,
  formatNombre,
  formatTaux,
  nbTermines,
  tauxLivraison,
  type LigneVentilation,
} from '@/lib/statistiques';

// Composant de rendu pur (pas de 'use client') : les quatre ventilations
// — livreur, ville, zone, client — n'affichent rien d'autre. Un seul tableau à
// faire évoluer plutôt que quatre copies qui divergeront.

// Sous ce nombre de colis terminés, un taux de livraison ne veut rien dire :
// 1 colis livré sur 1 affiche « 100 % » et prendrait la tête du classement.
// On affiche alors la mention plutôt que le chiffre — c'est une information,
// pas une absence d'information.
const SEUIL_SIGNIFICATIF = 5;

function BarreTaux({ taux }: { taux: number | null }) {
  if (taux === null) return <span className="text-xs opacity-40">—</span>;
  const couleur = taux >= 85 ? 'bg-emerald-500' : taux >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div className={`h-full rounded-full ${couleur}`} style={{ width: `${Math.min(100, taux)}%` }} />
      </div>
      <span className="tabular-nums text-xs font-semibold">{formatTaux(taux)}</span>
    </div>
  );
}

export function TableauVentilation({
  lignes,
  libelleColonne,
  messageVide,
}: {
  lignes: LigneVentilation[];
  libelleColonne: string;
  messageVide: string;
}) {
  if (lignes.length === 0) {
    return (
      <div className="table-card">
        <p className="empty-state">{messageVide}</p>
      </div>
    );
  }

  return (
    <div className="table-card">
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[820px]">
          <thead>
            <tr>
              <th className="w-10 text-right">#</th>
              <th>{libelleColonne}</th>
              <th className="text-right">Colis</th>
              <th className="text-right">Livrés</th>
              <th className="text-right">Retournés</th>
              <th className="text-right">En cours</th>
              <th>Taux de livraison</th>
              <th className="text-right">COD encaissé</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const taux = tauxLivraison(l.compteurs);
              const significatif = nbTermines(l.compteurs) >= SEUIL_SIGNIFICATIF;
              return (
                <tr key={l.cle}>
                  <td className="text-right text-xs opacity-40 tabular-nums">{i + 1}</td>
                  <td>
                    <span className="font-semibold">{l.libelle}</span>
                    {l.sousTitre && <span className="block text-xs opacity-55">{l.sousTitre}</span>}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{formatNombre(l.compteurs.total)}</td>
                  <td className="text-right tabular-nums">{formatNombre(l.compteurs.livres)}</td>
                  <td className="text-right tabular-nums">{formatNombre(l.compteurs.retournes)}</td>
                  <td className="text-right tabular-nums opacity-60">{formatNombre(l.compteurs.enCours)}</td>
                  <td>
                    {significatif ? (
                      <BarreTaux taux={taux} />
                    ) : (
                      <span className="text-xs opacity-40">
                        trop peu de colis terminés
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{formatDirhams(l.codEncaisse)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
