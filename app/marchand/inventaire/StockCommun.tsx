'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { apiGet } from '@/lib/api-client';

interface UniteCommune {
  produitId: string;
  varianteId: string | null;
  nom: string;
  sku: string;
  photoUrl: string | null;
  plateforme: string;
  disponible: number;
  annonce: number;
  enCours: number;
  livrees: number;
  retournees: number;
}

// § Stock commun (12/10/2026) : les produits du stock d'une plateforme
// partenaire que ce vendeur vend. Il ne les possède pas — le disponible est
// partagé avec les autres vendeurs de la plateforme, sans réservation — d'où
// un tableau à part, sans aucune action, et ses ventes à lui en regard.
export function StockCommun() {
  const [unites, setUnites] = useState<UniteCommune[]>([]);

  useEffect(() => {
    apiGet<{ data: UniteCommune[] }>('/api/produits/communs')
      .then((res) => setUnites(res.data))
      .catch(() => setUnites([]));
  }, []);

  if (unites.length === 0) return null;
  const plateformes = [...new Set(unites.map((u) => u.plateforme))].join(', ');

  return (
    <div className="table-card">
      <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Stock {plateformes}</h2>
        <p className="text-xs opacity-60">
          Produits communs que vous vendez. Le disponible est partagé avec les autres vendeurs : le premier colis arrivé
          est le premier servi.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th></th>
              <th>Produit</th>
              <th>Réf</th>
              <th className="text-right">Disponible ({plateformes})</th>
              <th className="text-right">Vos colis en cours</th>
              <th className="text-right">Livrés</th>
              <th className="text-right">Retournés</th>
            </tr>
          </thead>
          <tbody>
            {unites.map((u) => (
              <tr key={`${u.produitId}|${u.varianteId ?? ''}`}>
                <td className="w-12">
                  {u.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.photoUrl} alt={u.nom} className="h-9 w-9 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-black/[0.04] dark:bg-white/[0.06]">
                      <ImageOff className="h-4 w-4 opacity-40" />
                    </div>
                  )}
                </td>
                <td className="font-medium">{u.nom}</td>
                <td className="font-mono text-xs">{u.sku}</td>
                <td className="text-right">
                  <span className="badge bg-green-500/15 text-green-700 dark:text-green-400">{u.disponible}</span>
                  {u.annonce > 0 && <span className="ml-1 text-xs opacity-60">+{u.annonce} en route</span>}
                </td>
                <td className="text-right">{u.enCours}</td>
                <td className="text-right">{u.livrees}</td>
                <td className="text-right">{u.retournees}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
