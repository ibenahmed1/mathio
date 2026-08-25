'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer, Receipt } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Facture } from '@/lib/types';
import { BonsDocumentsSubNav } from '../BonsDocumentsSubNav';

// § Espace marchand — ses factures. Cette page lisait auparavant les colis
// regroupés par état de paiement, faute de document de facturation : elle
// s'appuie désormais sur les vraies factures (§ /admin/factures), dont les
// montants sont figés à l'émission.
// Le statut brouillon figure dans la table pour satisfaire le type, mais n'apparaîtra
// jamais : l'API ne sert au marchand que les factures emise/payee/annulee
// (cf. STATUTS_VISIBLES_MARCHAND). Une facture en préparation n'a pas encore
// été arrêtée — l'annoncer reviendrait à promettre un montant non décidé.
const LIBELLES: Record<Facture['statut'], string> = {
  brouillon: 'En préparation',
  emise: 'En attente de règlement',
  payee: 'Réglée',
  annulee: 'Annulée',
};

const CLASSES: Record<Facture['statut'], string> = {
  brouillon: 'bg-neutral-300 text-neutral-800',
  emise: 'bg-amber-400 text-amber-950',
  payee: 'bg-green-600 text-white',
  annulee: 'bg-neutral-400 text-neutral-900',
};

function montant(valeur: string | number) {
  return `${Number(valeur).toFixed(2)} DH`;
}

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [filtre, setFiltre] = useState<Facture['statut'] | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    apiGet<{ data: Facture[] }>('/api/factures?pageSize=100')
      .then((res) => setFactures(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setChargement(false));
  }, []);

  const filtrees = filtre ? factures.filter((f) => f.statut === filtre) : factures;

  const enAttente = factures
    .filter((f) => f.statut === 'emise')
    .reduce((s, f) => s + Number(f.netAPayer), 0);
  const dejaRegle = factures
    .filter((f) => f.statut === 'payee')
    .reduce((s, f) => s + Number(f.netAPayer), 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons &amp; Documents</h1>
      <BonsDocumentsSubNav />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs uppercase tracking-wide opacity-60">En attente de règlement</p>
          <p className="font-mono text-xl font-bold tabular-nums">{montant(enAttente)}</p>
        </div>
        <div className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs uppercase tracking-wide opacity-60">Déjà réglé</p>
          <p className="font-mono text-xl font-bold tabular-nums">{montant(dejaRegle)}</p>
        </div>
      </div>

      <select
        className="input-basic w-fit"
        value={filtre}
        onChange={(e) => setFiltre(e.target.value as Facture['statut'] | '')}
      >
        <option value="">Toutes les factures</option>
        <option value="emise">En attente</option>
        <option value="payee">Réglées</option>
        <option value="annulee">Annulées</option>
      </select>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[800px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Colis</th>
              <th>COD encaissé</th>
              <th>Frais</th>
              <th>Net</th>
              <th>Statut</th>
              <th>Émise le</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrees.map((f) => (
              <tr key={f.id}>
                <td className="font-mono">{f.numero}</td>
                <td className="tabular-nums">
                  {f.nbColisLivres}
                  {f.nbColisRetournes > 0 && ` + ${f.nbColisRetournes} retour`}
                </td>
                <td className="font-mono tabular-nums">{montant(f.totalCod)}</td>
                <td className="font-mono tabular-nums opacity-70">
                  −
                  {montant(
                    Number(f.totalFraisLivraison) + Number(f.totalFraisRetour) + Number(f.totalAutresFrais)
                  )}
                </td>
                <td className="font-mono font-bold tabular-nums">{montant(f.netAPayer)}</td>
                <td>
                  <span className={`badge ${CLASSES[f.statut]}`}>{LIBELLES[f.statut]}</span>
                </td>
                <td>{new Date(f.dateEmission).toLocaleDateString('fr-FR')}</td>
                <td>
                  <Link
                    href={`/factures/${f.id}`}
                    target="_blank"
                    className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                    title="Imprimer"
                  >
                    <Printer className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
            {filtrees.length === 0 && !chargement && (
              <tr>
                <td colSpan={8} className="py-6 text-center">
                  <Receipt className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  <span className="opacity-60">Aucune facture pour le moment.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
