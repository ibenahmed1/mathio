'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Ban,
  Banknote,
  Check,
  CreditCard,
  FilePlus2,
  FileText,
  Pencil,
  Printer,
  Receipt,
  Wallet,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import type { Facture, ModeReglementMarchand } from '@/lib/types';

const LIBELLES_STATUT: Record<Facture['statut'], string> = {
  brouillon: 'Brouillon',
  emise: 'Émise',
  payee: 'Réglée',
  annulee: 'Annulée',
};

const CLASSES_STATUT: Record<Facture['statut'], string> = {
  brouillon: 'bg-black/[0.08] text-black/70 dark:bg-white/15 dark:text-white/80',
  emise: 'bg-amber-400 text-amber-950',
  payee: 'bg-green-600 text-white',
  annulee: 'bg-neutral-400 text-neutral-900',
};

const MODES: { valeur: ModeReglementMarchand; label: string; icone: typeof Banknote }[] = [
  { valeur: 'virement', label: 'Virement', icone: CreditCard },
  { valeur: 'cheque', label: 'Chèque', icone: FileText },
  { valeur: 'especes', label: 'Espèces', icone: Banknote },
];

function montant(valeur: string | number) {
  return `${Number(valeur).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

export default function ToutesFacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [filtre, setFiltre] = useState<Facture['statut'] | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  // Deux modales plutôt que deux window.prompt : le règlement demande un mode
  // ET une référence, l'annulation un motif libre. Un prompt natif ne sait
  // porter qu'un seul champ, et ne dit pas ce qu'on est en train d'engager.
  const [aRegler, setARegler] = useState<Facture | null>(null);
  const [mode, setMode] = useState<ModeReglementMarchand>('virement');
  const [reference, setReference] = useState('');
  const [aAnnuler, setAAnnuler] = useState<Facture | null>(null);
  const [motif, setMotif] = useState('');

  const load = useCallback(() => {
    const query = filtre ? `?statut=${filtre}&pageSize=100` : '?pageSize=100';
    apiGet<{ data: Facture[] }>(`/api/factures${query}`)
      .then((res) => setFactures(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [filtre]);

  useEffect(() => {
    load();
  }, [load]);

  async function appeler(facture: Facture, action: string, body?: unknown) {
    setEnCours(facture.id);
    setError(null);
    try {
      await apiPost(`/api/factures/${facture.id}/${action}`, body);
      setARegler(null);
      setAAnnuler(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(null);
    }
  }

  // Deux cumuls distincts : ce qui est ENGAGÉ auprès des marchands (émis, dû)
  // et ce qui est encore en préparation (brouillons). Les additionner
  // gonflerait la dette d'un montant que personne n'a encore promis.
  const totalDu = factures.filter((f) => f.statut === 'emise').reduce((s, f) => s + Number(f.netAPayer), 0);
  const totalBrouillons = factures
    .filter((f) => f.statut === 'brouillon')
    .reduce((s, f) => s + Number(f.netAPayer), 0);
  const nbBrouillons = factures.filter((f) => f.statut === 'brouillon').length;

  const referenceRequise = mode !== 'especes';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title flex items-center gap-2">
          <Receipt className="h-6 w-6 text-brand-ink dark:text-brand" />
          Factures marchands
        </h1>
        <Link href="/admin/factures/nouvelle" className="btn-primary flex items-center gap-1.5">
          <FilePlus2 className="h-4 w-4" />
          Nouvelle facture
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input-basic"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value as Facture['statut'] | '')}
        >
          <option value="">Tous les statuts</option>
          <option value="brouillon">Brouillons</option>
          <option value="emise">Émises</option>
          <option value="payee">Réglées</option>
          <option value="annulee">Annulées</option>
        </select>
        <p className="text-sm opacity-70">
          Reste à régler : <strong className="font-mono">{montant(totalDu)}</strong>
        </p>
        {nbBrouillons > 0 && (
          <button
            type="button"
            onClick={() => setFiltre('brouillon')}
            className="badge badge-warn hover:brightness-95"
          >
            {nbBrouillons} brouillon{nbBrouillons > 1 ? 's' : ''} · {montant(totalBrouillons)} en préparation
          </button>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card overflow-x-auto">
        <table className="table-basic min-w-[1000px]">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Marchand</th>
              <th>Colis</th>
              <th className="text-right">CRBT</th>
              <th className="text-right">Frais</th>
              <th className="text-right">Net à reverser</th>
              <th>Statut</th>
              <th>Créée le</th>
              <th className="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {factures.map((f) => {
              const fraisTotal =
                Number(f.totalFraisLivraison) + Number(f.totalFraisRetour) + Number(f.totalAutresFrais);
              return (
                <tr key={f.id}>
                  <td className="font-mono">{f.numero}</td>
                  <td>
                    {f.marchand?.nomBoutique ?? '—'}
                    {f.marchand?.raisonSociale && (
                      <span className="block text-xs opacity-60">{f.marchand.raisonSociale}</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {f.nbColisLivres} livré{f.nbColisLivres > 1 ? 's' : ''}
                    {f.nbColisRetournes > 0 && ` · ${f.nbColisRetournes} retour`}
                  </td>
                  <td className="text-right font-mono tabular-nums">{montant(f.totalCod)}</td>
                  <td className="text-right font-mono tabular-nums opacity-70">
                    −{montant(fraisTotal)}
                    {Number(f.totalAutresFrais) > 0 && (
                      <span className="block text-[11px] opacity-70">
                        dont {montant(f.totalAutresFrais)} de frais annexes
                      </span>
                    )}
                  </td>
                  <td className="text-right font-mono font-bold tabular-nums">{montant(f.netAPayer)}</td>
                  <td>
                    <span className={`badge ${CLASSES_STATUT[f.statut]}`}>{LIBELLES_STATUT[f.statut]}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {new Date(f.dateEmission).toLocaleDateString('fr-FR')}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {f.statut === 'brouillon' ? (
                        <>
                          <Link
                            href={`/admin/factures/${f.id}/modifier`}
                            className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                            title="Reprendre le brouillon"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => appeler(f, 'emettre')}
                            disabled={enCours === f.id}
                            className="rounded p-1.5 text-green-700 hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950"
                            title="Émettre — fige les montants et rend la facture visible du marchand"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <Link
                          href={`/factures/${f.id}`}
                          target="_blank"
                          className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                          title="Imprimer"
                        >
                          <Printer className="h-4 w-4" />
                        </Link>
                      )}

                      {f.statut === 'emise' && (
                        <button
                          type="button"
                          onClick={() => {
                            setARegler(f);
                            setMode('virement');
                            setReference('');
                          }}
                          disabled={enCours === f.id}
                          className="rounded p-1.5 text-green-700 hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950"
                          title="Marquer comme réglée"
                        >
                          <Wallet className="h-4 w-4" />
                        </button>
                      )}

                      {(f.statut === 'brouillon' || f.statut === 'emise') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAAnnuler(f);
                            setMotif('');
                          }}
                          disabled={enCours === f.id}
                          className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"
                          title="Annuler"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {factures.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">Aucune facture pour ce filtre.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aRegler && (
        <Modal title={`Régler la facture ${aRegler.numero}`} onClose={() => setARegler(null)}>
          <p className="text-sm">
            Reversement de <strong className="font-mono">{montant(aRegler.netAPayer)}</strong> à{' '}
            <strong>{aRegler.marchand?.nomBoutique}</strong>. Une écriture comptable de sortie de caisse sera
            générée et les colis passeront à l&apos;état « payé ».
          </p>

          <div className="grid grid-cols-3 gap-2">
            {MODES.map(({ valeur, label, icone: Icone }) => (
              <button
                key={valeur}
                type="button"
                onClick={() => setMode(valeur)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-bold transition ${
                  mode === valeur
                    ? 'border-brand bg-brand/15'
                    : 'border-black/10 hover:bg-black/[0.04] dark:border-white/15 dark:hover:bg-white/10'
                }`}
              >
                <Icone className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {referenceRequise && (
            <input
              className="input-basic"
              placeholder={mode === 'cheque' ? 'N° de chèque' : 'Référence du virement'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              autoFocus
            />
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setARegler(null)} className="btn-outline">
              Annuler
            </button>
            <button
              type="button"
              onClick={() =>
                appeler(aRegler, 'payer', { modeReglement: mode, referenceReglement: reference })
              }
              disabled={enCours === aRegler.id || (referenceRequise && !reference.trim())}
              className="btn-primary"
            >
              {enCours === aRegler.id ? 'Enregistrement…' : 'Confirmer le règlement'}
            </button>
          </div>
        </Modal>
      )}

      {aAnnuler && (
        <Modal title={`Annuler la facture ${aAnnuler.numero}`} onClose={() => setAAnnuler(null)}>
          <p className="text-sm">
            Ses {aAnnuler.nbColisLivres + aAnnuler.nbColisRetournes} colis redeviendront facturables. La
            facture est conservée au statut « annulée » — elle n&apos;est jamais effacée.
          </p>
          {aAnnuler.statut === 'emise' && (
            <input
              className="input-basic"
              placeholder="Motif de l'annulation (obligatoire)"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              autoFocus
            />
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAAnnuler(null)} className="btn-outline">
              Revenir
            </button>
            <button
              type="button"
              onClick={() => appeler(aAnnuler, 'annuler', { motif })}
              disabled={enCours === aAnnuler.id || (aAnnuler.statut === 'emise' && !motif.trim())}
              className="btn-primary"
            >
              {enCours === aAnnuler.id ? 'Annulation…' : 'Confirmer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
