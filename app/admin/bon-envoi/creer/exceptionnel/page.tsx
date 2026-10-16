'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Send, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { QrScanner } from '@/components/QrScanner';
import { ChampDouchette } from '@/components/ChampDouchette';
import { CodeColis } from '@/components/colis/CodeColis';
import { annoncerEchec, annoncerSucces } from '@/lib/annonces';

// § BE exceptionnel (lib/bon-envoi-exceptionnel.ts) — débloquer une situation :
// transporteur choisi, motif, puis scan des colis. Le routage ne refuse rien ;
// chaque règle contournée est affichée ici et écrite dans l'historique du colis.

interface Transporteur {
  id: string;
  nom: string;
}

interface ColisScanne {
  id: string;
  codeSuivi: string;
  ville: string;
  statut: string;
  marchandNom: string | null;
  tarifAchat: number | null;
  contournements: string[];
}

interface ResultatCreation {
  id: string;
  numero: string;
  nbColis: number;
  power: boolean;
  remisePower: { totalRemis: number; totalNonRemis: number } | null;
  erreurPower: string | null;
}

export default function BonEnvoiExceptionnelPage() {
  const router = useRouter();
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [prestataireId, setPrestataireId] = useState('');
  const [motif, setMotif] = useState('');
  const [colis, setColis] = useState<ColisScanne[]>([]);
  const [scanOuvert, setScanOuvert] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiGet<{ transporteurs: Transporteur[] }>('/api/bons-envoi/transporteurs')
      .then((res) => setTransporteurs(res.transporteurs))
      .catch((err) => setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' }));
  }, []);

  const transporteur = transporteurs.find((t) => t.id === prestataireId) ?? null;
  const estPower = transporteur?.nom === 'Power Delivery';

  // Changer de transporteur change les contournements : le panier repart à zéro.
  function choisirTransporteur(id: string) {
    setPrestataireId(id);
    setColis([]);
    setMessage(null);
  }

  const handleScan = useCallback(
    async (raw: string) => {
      if (scanning || !prestataireId) return;
      setScanning(true);
      setMessage(null);
      try {
        const body = raw.includes('.') ? { qrPayload: raw, prestataireId } : { codeSuivi: raw, prestataireId };
        const c = await apiPost<ColisScanne>('/api/bons-envoi/exceptionnel/verifier', body);
        setColis((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
        setMessage({ type: 'success', text: `${c.codeSuivi} ajouté.` });
        annoncerSucces(`${c.codeSuivi} ajouté.`, { son: true });
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
        annoncerEchec(err, { son: true });
      } finally {
        setScanning(false);
      }
    },
    [scanning, prestataireId]
  );

  async function creer() {
    setCreating(true);
    setMessage(null);
    try {
      const res = await apiPost<ResultatCreation>('/api/bons-envoi/exceptionnel', {
        prestataireId,
        motif,
        colisIds: colis.map((c) => c.id),
      });
      let texte = `BE exceptionnel ${res.numero} créé : ${res.nbColis} colis.`;
      if (res.remisePower) texte += ` Power : ${res.remisePower.totalRemis} remis, ${res.remisePower.totalNonRemis} non remis.`;
      if (res.erreurPower) texte += ` Remise Power échouée (${res.erreurPower}) : relancez-la depuis le bon.`;
      if (res.erreurPower || (res.remisePower && res.remisePower.totalNonRemis > 0)) annoncerEchec(texte);
      else annoncerSucces(texte);
      router.push(`/admin/bon-envoi/${res.id}`);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
      annoncerEchec(err, { prefixe: 'BE exceptionnel' });
      setCreating(false);
    }
  }

  const motifValide = motif.trim().length >= 3;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/bon-envoi" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100 pointer-coarse:min-h-10">
        <ChevronLeft className="h-4 w-4" />
        Retour
      </Link>

      <h1 className="page-title">BE exceptionnel</h1>
      <p className="text-sm opacity-70">
        Pour débloquer une situation : les colis scannés partent chez le transporteur choisi même si leur ville ne passe pas
        chez lui. Une ville hors de sa grille n&apos;a pas de tarif. Tout est journalisé.
      </p>

      <div className="card-tint-strong grid gap-3 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold uppercase tracking-wide opacity-70">1. Transporteur</span>
          <select className="input-basic" value={prestataireId} onChange={(e) => choisirTransporteur(e.target.value)}>
            <option value="">Choisir…</option>
            {transporteurs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold uppercase tracking-wide opacity-70">2. Motif (obligatoire)</span>
          <input
            className="input-basic"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Ex. : ville non couverte, colis urgent"
            maxLength={300}
          />
        </label>
        {transporteur && (
          <p className="text-xs opacity-80 sm:col-span-2">
            {estPower
              ? 'Power Delivery : les colis leur seront envoyés par API à la création du bon.'
              : `Rien ne sera envoyé à ${transporteur.nom} par API : remise par l’Excel du bon.`}
          </p>
        )}
      </div>

      {prestataireId && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">3. Colis scannés ({colis.length})</h2>
            <button onClick={() => setScanOuvert((v) => !v)} className="btn-outline px-3 py-1.5 text-xs">
              {scanOuvert ? 'Fermer la caméra' : 'Ouvrir la caméra'}
            </button>
          </div>

          {message && (
            <div
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
                message.type === 'success'
                  ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                  : 'bg-red-500/15 text-red-700 dark:text-red-400'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="grid min-w-0 gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
            <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20">
              <ChampDouchette onScan={handleScan} disabled={scanning} />
              {scanOuvert && <QrScanner active={scanOuvert} onScan={handleScan} disabled={scanning} sansDouchette />}
            </div>

            <div className="min-w-0 overflow-x-auto">
              <table className="table-basic min-w-[640px]">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Marchand</th>
                    <th>Ville</th>
                    <th>Tarif achat</th>
                    <th>Règles contournées</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {colis.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <CodeColis id={c.id} code={c.codeSuivi} />
                      </td>
                      <td>{c.marchandNom ?? '—'}</td>
                      <td>{c.ville}</td>
                      <td className="whitespace-nowrap">{c.tarifAchat === null ? 'Sans tarif' : `${c.tarifAchat} DH`}</td>
                      <td className="text-xs">
                        {c.contournements.length === 0 ? (
                          <span className="opacity-60">Aucune</span>
                        ) : (
                          c.contournements.map((t) => (
                            <span key={t} className="badge mb-1 mr-1 bg-amber-300 text-amber-950">
                              {t}
                            </span>
                          ))
                        )}
                      </td>
                      <td>
                        <button
                          onClick={() => setColis((prev) => prev.filter((p) => p.id !== c.id))}
                          className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
                        >
                          <X className="h-3.5 w-3.5" /> Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {colis.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center opacity-60">
                        Scannez les colis à la douchette ou à la caméra.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!motifValide && colis.length > 0 && <p className="text-xs opacity-70">Saisissez le motif pour créer le bon.</p>}
            <button
              onClick={creer}
              disabled={colis.length === 0 || !motifValide || creating}
              className="btn-primary flex max-w-full items-center gap-2 whitespace-normal px-5 py-2.5"
            >
              <Send className="h-4 w-4 shrink-0" />
              {creating ? 'Création…' : `Créer le BE exceptionnel (${colis.length} colis)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
