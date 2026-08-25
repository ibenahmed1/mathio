'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, ChevronLeft, PackageCheck, ScanLine, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { QrScanner } from '@/components/QrScanner';
import { SignaturePad } from '@/components/SignaturePad';
import type { BilanBonRetour, BonRetour } from '@/lib/types';

// § Ramasseur — remise d'un bon de retour chez le marchand.
//
// Deux temps sur un seul écran, parce que c'est un seul geste sur le terrain :
// le ramasseur scanne (ou coche) les colis en les posant sur le comptoir,
// puis fait signer. La signature reste bloquée tant qu'il reste un colis dans
// le véhicule — faire signer une décharge pour des colis non remis
// engagerait le marchand sur ce qu'il n'a pas reçu.
type Toast = { type: 'success' | 'error'; text: string } | null;

export default function RemiseBonRetourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [bon, setBon] = useState<(BonRetour & { bilan: BilanBonRetour }) | null>(null);
  const [scanOuvert, setScanOuvert] = useState(false);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [nomSignataire, setNomSignataire] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const load = useCallback(() => {
    apiGet<BonRetour & { bilan: BilanBonRetour }>(`/api/bons-retour/${id}`)
      .then(setBon)
      .catch((err) => setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' }));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onScan = useCallback(
    async (raw: string, source: 'camera' | 'manual') => {
      setScanEnCours(true);
      try {
        const res = await apiPost<{ commande: { codeSuivi: string }; bilan: BilanBonRetour }>(
          `/api/bons-retour/${id}/scan-remise`,
          source === 'camera' ? { qrPayload: raw } : { codeSuivi: raw }
        );
        setBon((prev) => (prev ? { ...prev, bilan: res.bilan } : prev));
        setToast({ type: 'success', text: `${res.commande.codeSuivi} remis` });
      } catch (err) {
        setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
      } finally {
        setScanEnCours(false);
      }
    },
    [id]
  );

  // Repli quand le QR est abîmé ou que la caméra ne veut rien savoir : le
  // ramasseur coche le colis à la main. Passe par la même route que le scan,
  // donc par les mêmes contrôles.
  async function cocher(codeSuivi: string) {
    await onScan(codeSuivi, 'manual');
  }

  function chargerPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => setPhoto(typeof lecteur.result === 'string' ? lecteur.result : null);
    lecteur.readAsDataURL(fichier);
  }

  async function signer() {
    setEnvoi(true);
    setToast(null);
    try {
      await apiPost(`/api/bons-retour/${id}/signature`, {
        nomSignataire,
        signatureUrl: signature ?? undefined,
        photoDechargeUrl: photo ?? undefined,
      });
      router.push('/ramasseur/bons-retour');
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
      setEnvoi(false);
    }
  }

  if (!bon) {
    return <p className="p-6 opacity-60">Chargement…</p>;
  }

  const { bilan } = bon;
  const peutSigner = bilan.pretASigner && nomSignataire.trim().length > 0 && (signature || photo);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <button
        type="button"
        onClick={() => router.push('/ramasseur/bons-retour')}
        className="flex w-fit items-center gap-1 text-sm opacity-70"
      >
        <ChevronLeft className="h-4 w-4" />
        Mes bons de retour
      </button>

      <header>
        <h1 className="text-xl font-black">{bon.marchand?.nomBoutique}</h1>
        <p className="font-mono text-sm opacity-70">{bon.numero}</p>
        {bon.marchand?.adresse && <p className="text-sm opacity-70">{bon.marchand.adresse}</p>}
        {bon.marchand?.utilisateur?.telephone && (
          <a href={`tel:${bon.marchand.utilisateur.telephone}`} className="text-sm underline">
            {bon.marchand.utilisateur.telephone}
          </a>
        )}
      </header>

      {toast && (
        <p
          className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          }`}
        >
          {toast.text}
          <button type="button" onClick={() => setToast(null)} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      <div className="rounded-md border border-black/10 p-3 text-center dark:border-white/15">
        <p className="text-3xl font-black tabular-nums">
          {bilan.colisRemis.length}/{bilan.nbColis}
        </p>
        <p className="text-xs uppercase tracking-wide opacity-60">colis remis</p>
      </div>

      <button
        type="button"
        onClick={() => setScanOuvert((v) => !v)}
        className="btn-primary flex items-center justify-center gap-1.5"
      >
        <ScanLine className="h-4 w-4" />
        {scanOuvert ? 'Fermer le scan' : 'Scanner un colis'}
      </button>

      {scanOuvert && <QrScanner active={scanOuvert} onScan={onScan} disabled={scanEnCours} />}

      {bilan.colisRestants.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">
            À remettre ({bilan.colisRestants.length})
          </h2>
          <ul className="flex flex-col gap-1.5">
            {bilan.colisRestants.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 dark:border-white/15"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm">{c.codeSuivi}</p>
                  <p className="truncate text-xs opacity-60">{c.clientNom}</p>
                </div>
                <button
                  type="button"
                  onClick={() => cocher(c.codeSuivi)}
                  disabled={scanEnCours}
                  className="btn-outline shrink-0 text-xs"
                >
                  Remis
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {bilan.colisRemis.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">
            Déjà remis ({bilan.colisRemis.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {bilan.colisRemis.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-1 text-sm opacity-60">
                <PackageCheck className="h-4 w-4 shrink-0 text-green-600" />
                <span className="font-mono">{c.codeSuivi}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-2 flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/15">
        <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">Décharge</h2>

        {!bilan.pretASigner && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {bilan.colisRestants.length} colis restent à remettre avant de faire signer.
          </p>
        )}

        <input
          type="text"
          className="input-basic"
          placeholder="Nom de la personne qui signe"
          value={nomSignataire}
          onChange={(e) => setNomSignataire(e.target.value)}
        />

        <SignaturePad onChange={setSignature} />

        <label className="btn-outline flex cursor-pointer items-center justify-center gap-1.5">
          <Camera className="h-4 w-4" />
          {photo ? 'Photo du bon signé ajoutée' : 'Ou photographier le bon papier signé'}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={chargerPhoto} />
        </label>

        <button
          type="button"
          onClick={signer}
          disabled={!peutSigner || envoi}
          className="btn-primary flex items-center justify-center gap-1.5"
        >
          <Check className="h-4 w-4" />
          {envoi ? 'Enregistrement…' : 'Clôturer le bon'}
        </button>
      </section>
    </div>
  );
}
