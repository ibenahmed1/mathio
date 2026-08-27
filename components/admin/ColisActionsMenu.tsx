'use client';

import { useEffect, useState } from 'react';
import {
  MoreVertical,
  MapPinned,
  Info,
  CreditCard,
  SquarePen,
  MapPin,
  PackageX,
  Banknote,
  RotateCcw,
  Printer,
  FileText,
  MessageSquarePlus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api-client';
import type { Commande, Marchandise } from '@/lib/types';
import { LABELS_STATUT_COMMANDE, STATUTS_NON_LIVRAISON } from '@/lib/statuts';
import { Modal } from '@/components/admin/Modal';
import { ColisTrackingModal } from '@/components/admin/ColisTrackingModal';
import { ColisInfoModal } from '@/components/admin/ColisInfoModal';
import { ProduitSelect } from '@/components/ProduitSelect';

type ActionKey =
  | 'suivi'
  | 'information'
  | 'cin'
  | 'modifier'
  | 'ville'
  | 'non_livre'
  | 'prix'
  | 'remboursement'
  | 'commentaire'
  | 'supprimer';

const ACTIONS: { key: ActionKey; label: string; icon: typeof Info }[] = [
  { key: 'information', label: 'Information du colis', icon: Info },
  { key: 'cin', label: 'Téléverser CIN', icon: CreditCard },
  { key: 'modifier', label: 'Modifier le colis', icon: SquarePen },
  { key: 'ville', label: 'Change Ville', icon: MapPin },
  { key: 'non_livre', label: 'Colis non livré', icon: PackageX },
  { key: 'prix', label: 'Changer le prix', icon: Banknote },
  { key: 'remboursement', label: 'Remboursement', icon: RotateCcw },
  { key: 'commentaire', label: 'Laisser un commentaire', icon: MessageSquarePlus },
];

export function ColisActionsMenu({ commande, onChanged }: { commande: Commande; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Champs de formulaire des différents modals. Le modal "Modifier le colis"
  // reprend exactement les mêmes champs et le même statut requis/optionnel
  // que ColisEditModal côté marchand (Destinataire/Téléphone/Ville/Adresse
  // requis) — seule différence : les champs réservés à l'admin (CIN, livreur)
  // vivent dans leurs propres actions, comme côté marchand ils n'existent pas.
  const [clientNom, setClientNom] = useState(commande.clientNom);
  const [clientTelephone, setClientTelephone] = useState(commande.clientTelephone);
  const [adresse, setAdresse] = useState(commande.adresse);
  const [produitDescription, setProduitDescription] = useState(commande.produitDescription ?? '');
  const [produitId, setProduitId] = useState(commande.produitId ?? '');
  const [marchandiseId, setMarchandiseId] = useState(commande.marchandiseId ?? '');
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [prixAuto, setPrixAuto] = useState(false);
  const [quantite, setQuantite] = useState(String(commande.quantite ?? 1));
  const [colisARemplacerCode, setColisARemplacerCode] = useState(commande.colisARemplacer?.codeSuivi ?? '');
  const [notesModif, setNotesModif] = useState(commande.notes ?? '');
  const [ouvrirModif, setOuvrirModif] = useState(commande.ouvrir);
  const [fragileModif, setFragileModif] = useState(commande.fragile);
  const [aRemplacerModif, setARemplacerModif] = useState(commande.aRemplacer);
  const [enStockModif, setEnStockModif] = useState(commande.enStock);
  const [ville, setVille] = useState(commande.ville);
  const [montantCod, setMontantCod] = useState(commande.montantCod);
  const [nonLivreStatut, setNonLivreStatut] = useState(STATUTS_NON_LIVRAISON[0]);
  const [texte, setTexte] = useState('');
  const [cinFile, setCinFile] = useState<string | null>(null);

  // Catalogue du marchand propriétaire de ce colis (pas celui de l'admin,
  // qui n'en a pas) — permet de réassigner une marchandise comme le ferait
  // le marchand lui-même depuis son propre formulaire d'édition.
  useEffect(() => {
    if (modal !== 'modifier') return;
    apiGet<{ data: Marchandise[] }>(`/api/marchandises?marchandId=${commande.marchandId}`)
      .then((res) => setMarchandises(res.data))
      .catch(() => setMarchandises([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  function recalculerPrix(id: string, qte: string) {
    const m = marchandises.find((x) => x.id === id);
    if (!m) return;
    const quantiteNum = Number(qte) || 1;
    setMontantCod((Number(m.prix) * quantiteNum).toFixed(2));
    setPrixAuto(true);
  }

  function closeAll() {
    setOpen(false);
    setModal(null);
    setError(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      closeAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCinFile(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
        Actions
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-black">
            <button
              onClick={() => {
                setOpen(false);
                setModal('suivi');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <MapPinned className="h-4 w-4" /> Suivi du colis
            </button>
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  setOpen(false);
                  setModal(a.key);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <a.icon className="h-4 w-4" /> {a.label}
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false);
                window.open(`/admin/colis/${commande.id}/ticket`, '_blank');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Printer className="h-4 w-4" /> Imprimer Ticket
            </button>
            <button
              onClick={() => {
                setOpen(false);
                window.open(`/admin/colis/${commande.id}/e-ticket`, '_blank');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <FileText className="h-4 w-4" /> Imprimer E-Ticket
            </button>
            {commande.statut === 'nouveau_colis' && (
              <>
                <div className="my-1 border-t border-black/10 dark:border-white/10" />
                <button
                  onClick={() => {
                    setOpen(false);
                    setModal('supprimer');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-4 w-4" /> Supprimer le colis
                </button>
              </>
            )}
          </div>
        </>
      )}

      {modal === 'suivi' && <ColisTrackingModal commandeId={commande.id} onClose={closeAll} />}

      {modal === 'information' && (
        <ColisInfoModal commande={commande} onClose={closeAll} onTrack={() => setModal('suivi')} />
      )}

      {modal === 'cin' && (
        <Modal title="Téléverser la CIN" onClose={closeAll}>
          <input type="file" accept="image/*" onChange={handleFileChange} className="input-basic" />
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local en data URL, non optimisable par next/image */}
          {cinFile && <img src={cinFile} alt="Aperçu CIN" className="max-h-64 rounded-md border border-black/10 object-contain dark:border-white/10" />}
          {commande.cinUrl && !cinFile && (
            <p className="text-xs opacity-60">Une CIN est déjà enregistrée pour ce colis.</p>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy || !cinFile}
              onClick={() => run(() => apiPatch(`/api/commandes/${commande.id}`, { cinUrl: cinFile }))}
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'modifier' && (
        <Modal title={`Modifier le colis — ${commande.codeSuivi}`} onClose={closeAll}>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              Destinataire <span className="text-red-600">*</span>
              <input
                className="input-basic"
                value={clientNom}
                onChange={(e) => setClientNom(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Téléphone <span className="text-red-600">*</span>
              <input
                className="input-basic"
                value={clientTelephone}
                onChange={(e) => setClientTelephone(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Ville <span className="text-red-600">*</span>
              <input className="input-basic" value={ville} onChange={(e) => setVille(e.target.value)} required />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              Adresse <span className="text-red-600">*</span>
              <input
                className="input-basic"
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Marchandise
              <select
                className="input-basic"
                value={marchandiseId}
                onChange={(e) => {
                  setMarchandiseId(e.target.value);
                  recalculerPrix(e.target.value, quantite);
                }}
              >
                <option value="">Aucune…</option>
                {marchandises.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom} — {m.prix} DH
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Quantité
              <input
                className="input-basic"
                type="number"
                min="1"
                value={quantite}
                onChange={(e) => {
                  setQuantite(e.target.value);
                  if (marchandiseId) recalculerPrix(marchandiseId, e.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Prix (DH) <span className="text-red-600">*</span>
              <div className="relative">
                <input
                  className="input-basic w-full pr-8"
                  type="number"
                  step="0.01"
                  value={montantCod}
                  onChange={(e) => {
                    setMontantCod(e.target.value);
                    setPrixAuto(false);
                  }}
                  required
                />
                {prixAuto && (
                  <Sparkles className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" />
                )}
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description produit
              <input className="input-basic" value={produitDescription} onChange={(e) => setProduitDescription(e.target.value)} />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              Colis à remplacer (code de suivi)
              <input
                className="input-basic"
                value={colisARemplacerCode}
                onChange={(e) => setColisARemplacerCode(e.target.value)}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              Commentaire
              <textarea className="input-basic" rows={2} value={notesModif} onChange={(e) => setNotesModif(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ouvrirModif} onChange={(e) => setOuvrirModif(e.target.checked)} />
              Ouvrir
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fragileModif} onChange={(e) => setFragileModif(e.target.checked)} />
              Fragile
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={aRemplacerModif} onChange={(e) => setARemplacerModif(e.target.checked)} />
              À remplacer (échange)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enStockModif}
                onChange={(e) => {
                  setEnStockModif(e.target.checked);
                  if (!e.target.checked) setProduitId('');
                }}
              />
              En stock (entrepôt)
            </label>
            {enStockModif && (
              <label className="col-span-2 flex flex-col gap-1 text-sm">
                Produit du stock
                <ProduitSelect
                  marchandId={commande.marchandId}
                  value={produitId}
                  onSelect={(produit) => {
                    setProduitId(produit?.id ?? '');
                    if (produit) setProduitDescription(produit.nom);
                  }}
                />
                <span className="text-xs opacity-50">Recherche par nom ou référence — pré-remplit la description</span>
              </label>
            )}
            <p className="col-span-2 -mt-1 text-xs opacity-50">* Champs obligatoires</p>
          </div>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  apiPatch(`/api/commandes/${commande.id}`, {
                    clientNom,
                    clientTelephone,
                    ville,
                    adresse,
                    marchandiseId: marchandiseId || null,
                    produitDescription,
                    produitId: produitId || null,
                    quantite: Number(quantite) || 1,
                    montantCod,
                    colisARemplacerCode,
                    notes: notesModif,
                    ouvrir: ouvrirModif,
                    fragile: fragileModif,
                    aRemplacer: aRemplacerModif,
                    enStock: enStockModif,
                  })
                )
              }
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'ville' && (
        <Modal title="Changer la ville" onClose={closeAll}>
          <label className="flex flex-col gap-1 text-sm">
            Ville
            <input className="input-basic" value={ville} onChange={(e) => setVille(e.target.value)} />
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy || !ville.trim()}
              onClick={() => run(() => apiPatch(`/api/commandes/${commande.id}`, { ville }))}
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'non_livre' && (
        <Modal title="Colis non livré" onClose={closeAll}>
          <label className="flex flex-col gap-1 text-sm">
            Motif
            <select className="input-basic" value={nonLivreStatut} onChange={(e) => setNonLivreStatut(e.target.value as typeof nonLivreStatut)}>
              {STATUTS_NON_LIVRAISON.map((s) => (
                <option key={s} value={s}>
                  {LABELS_STATUT_COMMANDE[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Commentaire (optionnel)
            <textarea className="input-basic" rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} />
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await apiPatch(`/api/commandes/${commande.id}/statut`, {
                    statut: nonLivreStatut,
                    motifRetour: nonLivreStatut === 'refuse' ? texte || 'Non livré' : undefined,
                  });
                  if (texte.trim()) {
                    await apiPost(`/api/commandes/${commande.id}/commentaires`, { texte });
                  }
                })
              }
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'prix' && (
        <Modal title="Changer le prix" onClose={closeAll}>
          <label className="flex flex-col gap-1 text-sm">
            Montant COD (DH)
            <input
              type="number"
              min={0}
              step="0.01"
              className="input-basic"
              value={montantCod}
              onChange={(e) => setMontantCod(e.target.value)}
            />
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => run(() => apiPatch(`/api/commandes/${commande.id}`, { montantCod }))}
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'remboursement' && (
        <Modal title="Remboursement" onClose={closeAll}>
          <p className="text-sm">
            Confirmer le remboursement du colis <span className="font-mono">{commande.codeSuivi}</span> (
            {commande.montantCod} DH) ?
          </p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => run(() => apiPatch(`/api/commandes/${commande.id}/paiement`, { etatPaiement: 'rembourse' }))}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'supprimer' && (
        <Modal title="Supprimer le colis" onClose={closeAll}>
          <p className="text-sm">
            Supprimer définitivement le colis <span className="font-mono">{commande.codeSuivi}</span> ? Cette action est
            irréversible.
          </p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={() => run(() => apiDelete(`/api/commandes/${commande.id}`))}
            >
              Supprimer
            </button>
          </div>
        </Modal>
      )}

      {modal === 'commentaire' && (
        <Modal title="Laisser un commentaire" onClose={closeAll}>
          <textarea
            className="input-basic"
            rows={4}
            placeholder="Écrire une note interne sur ce colis…"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
          />
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn-primary"
              disabled={busy || !texte.trim()}
              onClick={() => run(() => apiPost(`/api/commandes/${commande.id}/commentaires`, { texte }))}
            >
              Publier
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
