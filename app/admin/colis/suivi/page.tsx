'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, MessageSquarePlus } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { EtatPaiementBadge } from '@/components/EtatPaiementBadge';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { Modal } from '@/components/admin/Modal';
import { PreuveLivraison } from '@/components/PreuveLivraison';

interface EvenementCircuit {
  type: 'statut' | 'commentaire';
  horodatage: string;
  auteur: string;
  texte: string;
  note?: string | null;
}

function construireCircuit(commande: Commande): EvenementCircuit[] {
  const evenements: EvenementCircuit[] = [];
  for (const h of commande.historique ?? []) {
    evenements.push({
      type: 'statut',
      horodatage: h.horodatage,
      auteur: h.utilisateur?.nomComplet ?? '—',
      texte: LABELS_STATUT_COMMANDE[h.nouveauStatut as keyof typeof LABELS_STATUT_COMMANDE] ?? h.nouveauStatut,
      note: h.note,
    });
  }
  for (const c of commande.commentaires ?? []) {
    evenements.push({
      type: 'commentaire',
      horodatage: c.dateCreation,
      auteur: c.utilisateur?.nomComplet ?? '—',
      texte: c.texte,
    });
  }
  return evenements.sort((a, b) => new Date(a.horodatage).getTime() - new Date(b.horodatage).getTime());
}

function AdminSuiviColisContent() {
  const searchParams = useSearchParams();
  const idInitial = searchParams.get('id') ?? '';

  const [code, setCode] = useState('');
  const [commande, setCommande] = useState<Commande | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalCommentaire, setModalCommentaire] = useState(false);
  const [texte, setTexte] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadById(id: string) {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiGet<Commande>(`/api/commandes/${id}`);
      setCommande(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (idInitial) loadById(idInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idInitial]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    setCommande(null);
    try {
      const res = await apiGet<{ data: Commande[] }>(`/api/commandes?search=${encodeURIComponent(code.trim())}`);
      const match = res.data.find((c) => c.codeSuivi.toLowerCase() === code.trim().toLowerCase()) ?? res.data[0];
      if (!match) {
        setError('Aucun colis trouvé pour ce code.');
        return;
      }
      await loadById(match.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  async function publierCommentaire() {
    if (!commande || !texte.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/commandes/${commande.id}/commentaires`, { texte });
      setTexte('');
      setModalCommentaire(false);
      await loadById(commande.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const circuit = commande ? construireCircuit(commande) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Suivi colis</h1>

      <form onSubmit={handleSearch} className="flex max-w-md gap-2">
        <input
          className="input-basic flex-1"
          placeholder="Code de suivi (ex. PD-000123)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
          <Search className="h-4 w-4" />
          Suivre
        </button>
      </form>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {commande && (
        <div className="flex flex-col gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-lg font-bold">{commande.codeSuivi}</p>
              <p className="text-sm opacity-70">
                {commande.clientNom} — {commande.ville}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <EtatPaiementBadge etat={commande.etatPaiement} />
              <StatutBadge statut={commande.statut} hubVille={commande.hubActuel?.ville} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <p className="opacity-60">Magasin</p>
            <p className="col-span-3">{commande.marchand?.nomBoutique ?? '—'}</p>
            <p className="opacity-60">Marchandise</p>
            <p className="col-span-3">
              {commande.marchandise?.nom ?? commande.produitDescription ?? '—'}
              {commande.quantite > 1 ? ` × ${commande.quantite}` : ''}
            </p>
            <p className="opacity-60">Montant</p>
            <p className="col-span-3">{commande.montantCod} DH</p>
            <p className="opacity-60">Colis à remplacer</p>
            <p className="col-span-3 font-mono">{commande.colisARemplacer?.codeSuivi ?? '—'}</p>
            <p className="opacity-60">Options</p>
            <p className="col-span-3 flex gap-1">
              {commande.ouvrir && <span className="badge badge-neutral">Ouvrir</span>}
              {commande.fragile && <span className="badge badge-warn">Fragile</span>}
              {!commande.ouvrir && !commande.fragile && '—'}
            </p>
            <p className="opacity-60">Commentaire</p>
            <p className="col-span-3">{commande.notes ?? '—'}</p>
            <p className="opacity-60">Ramasseur</p>
            <p className="col-span-3">{commande.ramassage?.ramasseur?.nomComplet ?? '—'}</p>
            <p className="opacity-60">Livreur</p>
            <p className="col-span-3">{commande.livreur?.nomComplet ?? '— non assigné —'}</p>
          </div>

          {/* § Preuve de livraison (RG-02) : photo et signature recueillies
              par le livreur, seule pièce justificative de la remise au
              client — affichée ici, sur la fiche de suivi, plutôt que
              seulement stockée en base. */}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Preuve de livraison</h2>
            <PreuveLivraison
              photoPreuveUrl={commande.photoPreuveUrl}
              signatureUrl={commande.signatureUrl}
              dateLivraison={commande.dateLivraison}
            />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Circuit du colis</h2>
            <button onClick={() => setModalCommentaire(true)} className="btn-outline flex items-center gap-2 px-2 py-1 text-xs">
              <MessageSquarePlus className="h-4 w-4" />
              Laisser un commentaire
            </button>
          </div>

          <ol className="flex flex-col gap-3 border-l-2 border-brand pl-4">
            {circuit.map((ev, i) => (
              <li key={i} className="text-sm">
                {ev.type === 'statut' ? (
                  <>
                    <p className="font-semibold">{ev.texte}</p>
                    {/* § Qui livre, pas seulement qui a agi : la note porte
                        l'info métier (ex. affecté au livreur X) quand elle
                        existe — sinon " — {auteur}" ci-dessous ne montre que
                        l'auteur de l'action (souvent un admin). */}
                    {ev.note && <p className="opacity-90">{ev.note}</p>}
                  </>
                ) : (
                  <p className="italic opacity-90">&laquo; {ev.texte} &raquo;</p>
                )}
                <p className="opacity-60">
                  {new Date(ev.horodatage).toLocaleString('fr-FR')} — {ev.auteur}
                </p>
              </li>
            ))}
            {circuit.length === 0 && <li className="text-sm opacity-60">Aucun historique</li>}
          </ol>
        </div>
      )}

      {modalCommentaire && (
        <Modal title="Laisser un commentaire" onClose={() => setModalCommentaire(false)}>
          <textarea
            className="input-basic"
            rows={4}
            placeholder="Écrire une note interne sur ce colis…"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setModalCommentaire(false)} disabled={busy}>
              Annuler
            </button>
            <button className="btn-primary" onClick={publierCommentaire} disabled={busy || !texte.trim()}>
              Publier
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function AdminSuiviColisPage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <AdminSuiviColisContent />
    </Suspense>
  );
}
