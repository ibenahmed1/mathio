'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, FileSearch } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { EtatPaiementBadge } from '@/components/EtatPaiementBadge';
import { BonsDocumentsSubNav } from '../BonsDocumentsSubNav';

// Pas de table "factures" dédiée : la facturation suit l'état de paiement du
// colis (etatPaiement) déjà géré par l'admin/finance — cette page consulte les
// colis facturés/payés/remboursés du marchand, regroupés comme des factures.
const ETATS_FACTURABLES = ['facture', 'paye', 'rembourse'] as const;

export default function FacturesPage() {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [filtre, setFiltre] = useState<(typeof ETATS_FACTURABLES)[number] | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    apiGet<{ data: Commande[] }>('/api/commandes?pageSize=100')
      .then((res) => setCommandes(res.data.filter((c) => ETATS_FACTURABLES.includes(c.etatPaiement as (typeof ETATS_FACTURABLES)[number]))))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setChargement(false));
  }, []);

  const filtrees = useMemo(
    () => (filtre ? commandes.filter((c) => c.etatPaiement === filtre) : commandes),
    [commandes, filtre]
  );

  const totaux = useMemo(() => {
    const parEtat = { facture: 0, paye: 0, rembourse: 0 };
    for (const c of commandes) {
      parEtat[c.etatPaiement as keyof typeof parEtat] += Number(c.montantCod);
    }
    return parEtat;
  }, [commandes]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons & Documents</h1>
      <BonsDocumentsSubNav />

      <p className="max-w-2xl text-sm opacity-70">
        Consultation des colis facturés par la plateforme : leur montant COD est comptabilisé ici dès que l&apos;état
        de paiement passe à « Facturé », « Payé » ou « Remboursé ».
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            { key: 'facture', label: 'Facturé', color: 'text-black dark:text-white' },
            { key: 'paye', label: 'Payé', color: 'text-emerald-600 dark:text-emerald-400' },
            { key: 'rembourse', label: 'Remboursé', color: 'text-purple-600 dark:text-purple-400' },
          ] as const
        ).map((k) => (
          <button
            key={k.key}
            onClick={() => setFiltre(filtre === k.key ? '' : k.key)}
            className={`rounded-xl border p-4 text-left shadow-sm transition ${
              filtre === k.key ? 'border-brand bg-brand/5' : 'border-black/10 hover:border-black/20 dark:border-white/10'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{k.label}</p>
            <p className={`text-2xl font-black tabular-nums ${k.color}`}>{totaux[k.key].toFixed(2)} DH</p>
          </button>
        ))}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[760px]">
            <thead>
              <tr>
                <th>Code d&apos;envoi</th>
                <th>Destinataire</th>
                <th>Ville</th>
                <th className="text-right">Montant</th>
                <th>État</th>
                <th>Date de livraison</th>
              </tr>
            </thead>
            <tbody>
              {filtrees.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                  <td>{c.clientNom}</td>
                  <td>{c.ville}</td>
                  <td className="text-right font-semibold tabular-nums">{c.montantCod} DH</td>
                  <td>
                    <EtatPaiementBadge etat={c.etatPaiement} />
                  </td>
                  <td className="text-xs opacity-70">
                    {c.dateLivraison ? new Date(c.dateLivraison).toLocaleDateString('fr-FR') : '—'}
                  </td>
                </tr>
              ))}
              {!chargement && filtrees.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      {filtre ? <FileSearch className="h-8 w-8 opacity-40" /> : <Receipt className="h-8 w-8 opacity-40" />}
                      <p className="font-medium">Aucune facture</p>
                      <p className="text-xs">
                        {filtre ? 'Aucun colis dans cet état pour le moment.' : 'Rien à facturer pour le moment.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
