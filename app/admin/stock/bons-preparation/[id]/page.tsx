'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, PackageCheck, Tags, Ticket } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonDePreparation } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { Button } from '@/components/admin/Button';

export default function BonPreparationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bon, setBon] = useState<BonDePreparation | null>(null);
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setChargement(true);
    setError(null);
    try {
      const res = await apiGet<BonDePreparation>(`/api/bons-preparation/${id}`);
      setBon(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirmerBienRecu() {
    setBusy(true);
    setError(null);
    try {
      await apiPost<BonDePreparation>(`/api/bons-preparation/${id}/bien-recu`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  if (chargement) return <p className="opacity-60">Chargement…</p>;
  if (!bon) return <p className="text-sm font-medium text-red-600">{error ?? 'Bon de préparation introuvable'}</p>;

  const estValidee = bon.statut === 'validee';

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/stock/bons-preparation" className="flex w-fit items-center gap-1 text-sm opacity-70 hover:opacity-100">
        <ArrowLeft className="h-4 w-4" /> Retour aux bons de préparation
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title font-mono">{bon.numero}</h1>
          <p className="text-sm opacity-70">
            {bon.marchand?.nomBoutique ?? '—'} — {bon.nbColis} colis — généré le {new Date(bon.dateGeneration).toLocaleString('fr-FR')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${estValidee ? 'bg-green-600 text-white' : 'badge-neutral'}`}>
            {estValidee ? 'Reçu' : 'En attente de réception'}
          </span>
          <Button
            variant="secondary"
            onClick={() => window.open(`/bons-preparation/${id}`, '_blank')}
            icon={<FileText className="h-4 w-4" />}
          >
            Voir en PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.open(`/bons-preparation/${id}?format=etiquettes`, '_blank')}
            icon={<Tags className="h-4 w-4" />}
          >
            Étiquettes
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.open(`/bons-preparation/${id}?format=e-tickets`, '_blank')}
            icon={<Ticket className="h-4 w-4" />}
          >
            E-tickets
          </Button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {estValidee && bon.dateValidation && (
        <p className="text-sm opacity-70">
          Reçu le {new Date(bon.dateValidation).toLocaleString('fr-FR')}
          {bon.validateur ? ` par ${bon.validateur.nomComplet}` : ''}
        </p>
      )}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[820px]">
            <thead>
              <tr>
                <th>Code suivi</th>
                <th>Client</th>
                <th>Produit</th>
                <th>Quantité</th>
                <th>Ville</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {(bon.commandes ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                  <td>{c.clientNom}</td>
                  <td>
                    {c.produit?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}
                    {c.produit?.reference && <span className="ml-1 font-mono text-xs opacity-50">({c.produit.reference})</span>}
                  </td>
                  <td>{c.quantite}</td>
                  <td>{c.ville}</td>
                  <td>
                    <StatutBadge statut={c.statut} />
                  </td>
                </tr>
              ))}
              {(bon.commandes ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center opacity-60">
                    Aucun colis dans ce bon
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-black/10 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm opacity-70">
            {estValidee
              ? 'Ce bon a déjà été marqué comme reçu.'
              : 'Le stock a déjà été décrémenté lors du passage « prêt pour préparation ». Confirmer la réception fait passer les colis en attente de ramassage au statut « Ramassé ».'}
          </p>
          <Button onClick={confirmerBienRecu} disabled={busy || estValidee} icon={<PackageCheck className="h-4 w-4" />}>
            {estValidee ? 'Déjà reçu' : busy ? 'Confirmation…' : 'Bon bien reçu'}
          </Button>
        </div>
      </div>
    </div>
  );
}
