'use client';

import { useEffect, useState } from 'react';
import { PackageCheck, Truck, Undo2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonRetour } from '@/lib/types';
import { BonsDocumentsSubNav } from '../BonsDocumentsSubNav';

// § Espace marchand — ses bons de retour. La route API ne lui expose que les
// bons `en_cours` et `remis` : tant qu'un bon est encore en composition au
// hub, ses colis n'ont pas bougé et l'annoncer n'aurait aucun sens pour lui.
function montant(valeur: string | number) {
  return `${Number(valeur).toFixed(2)} DH`;
}

export default function BonsRetourPage() {
  const [bons, setBons] = useState<BonRetour[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    apiGet<{ data: BonRetour[] }>('/api/bons-retour?pageSize=100')
      .then((res) => setBons(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons &amp; Documents</h1>
      <BonsDocumentsSubNav />

      <p className="text-sm opacity-70">
        Colis en échec de livraison qui vous sont rapportés. Un bon apparaît ici dès qu&apos;un ramasseur part
        avec vos colis, et se clôture à votre signature.
      </p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[760px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Colis</th>
              <th>Valeur COD</th>
              <th>Ramasseur</th>
              <th>Statut</th>
              <th>Remis le</th>
            </tr>
          </thead>
          <tbody>
            {bons.map((b) => (
              <tr key={b.id}>
                <td className="font-mono">{b.numero}</td>
                <td className="tabular-nums">{b.nbColis}</td>
                <td className="font-mono tabular-nums">{montant(b.montantTotalCod)}</td>
                <td>{b.ramasseur?.nomComplet ?? '—'}</td>
                <td>
                  <span
                    className={`badge inline-flex items-center gap-1 ${
                      b.statut === 'remis' ? 'bg-green-600 text-white' : 'bg-cyan-400 text-cyan-950'
                    }`}
                  >
                    {b.statut === 'remis' ? (
                      <>
                        <PackageCheck className="h-3.5 w-3.5" />
                        Réceptionné
                      </>
                    ) : (
                      <>
                        <Truck className="h-3.5 w-3.5" />
                        En route
                      </>
                    )}
                  </span>
                </td>
                <td>{b.dateRemise ? new Date(b.dateRemise).toLocaleDateString('fr-FR') : '—'}</td>
              </tr>
            ))}
            {bons.length === 0 && !chargement && (
              <tr>
                <td colSpan={6} className="py-6 text-center">
                  <Undo2 className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  <span className="opacity-60">Aucun retour en cours.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
