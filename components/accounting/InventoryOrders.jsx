"use client";

import { useEffect, useState } from "react";
import { Box, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { Affix, Field } from "@/components/form/Field";
import {
  LABELS_STATUT_COMMANDE_STOCK_HUB,
  STATUTS_COMMANDE_STOCK_HUB,
  formatMontantCommandeStockHub,
  formatNumeroCommandeStockHub,
} from "@/lib/commandes-stock-hub";
import a from "./Accounting.module.css";

const CHAMPS_VIDES = { titre: "", sousTitre: "", montant: "", statut: "en_attente", modePaiement: "", dateCommande: "" };

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InventoryOrders() {
  const [commandes, setCommandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [error, setError] = useState(null);
  const [modalOuverte, setModalOuverte] = useState(false);
  const [form, setForm] = useState(CHAMPS_VIDES);
  const [formError, setFormError] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  async function charger() {
    setChargement(true);
    try {
      const res = await apiGet("/api/commandes-stock-hub");
      setCommandes(res.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => charger());
  }, []);

  function ouvrir() {
    setFormError(null);
    setModalOuverte(true);
  }

  // Pas de fermeture pendant l'envoi : la fenêtre disparaîtrait avant que
  // l'erreur éventuelle de l'API ait un endroit où s'afficher.
  function fermer() {
    if (!envoi) setModalOuverte(false);
  }

  async function soumettre(e) {
    e.preventDefault();
    setFormError(null);

    const montant = Number(form.montant);
    if (!form.titre.trim() || !form.modePaiement.trim()) {
      setFormError("Le titre et le mode de paiement sont requis.");
      return;
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      setFormError("Le montant doit être un nombre positif.");
      return;
    }
    if (!form.dateCommande) {
      setFormError("La date de commande est requise.");
      return;
    }

    setEnvoi(true);
    try {
      await apiPost("/api/commandes-stock-hub", {
        titre: form.titre.trim(),
        sousTitre: form.sousTitre.trim() || undefined,
        montant,
        statut: form.statut,
        modePaiement: form.modePaiement.trim(),
        dateCommande: new Date(form.dateCommande).toISOString(),
      });
      setModalOuverte(false);
      setForm(CHAMPS_VIDES);
      charger();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  const listeVide = !chargement && !error && commandes.length === 0;

  return (
    <>
      <section className={a.card}>
        <div className={a.cardHead}>
          <div className={a.tableTitle}>
            <h2 className={a.cardTitle}>Commandes d&apos;inventaire</h2>
            <p className={a.cardSub}>Approvisionnement des hubs</p>
          </div>
          {/* Masqué sur liste vide : l'état vide porte déjà l'action, deux
              boutons « Ajouter » à trois centimètres l'un de l'autre. */}
          {commandes.length > 0 && (
            <button type="button" className="btn-outline btn-sm" onClick={ouvrir}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Ajouter
            </button>
          )}
        </div>

        {error && <p className="form-error mt-3">{error}</p>}

        {chargement && commandes.length === 0 ? (
          <div className="empty-state">Chargement…</div>
        ) : listeVide ? (
          <div className="empty-state">
            <Box size={28} className="opacity-40" aria-hidden />
            <p className="font-semibold text-black/70 dark:text-white/70">Aucune commande d&apos;inventaire</p>
            <p>Achats de matériel et d&apos;aménagement pour les hubs.</p>
            <button type="button" className="btn-outline btn-sm mt-2" onClick={ouvrir}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Ajouter une commande
            </button>
          </div>
        ) : (
          <div className={a.orderList}>
            {commandes.map((c) => (
              <article key={c.id} className={a.order}>
                <header className={a.orderHead}>
                  <span className={a.orderLabel}>Commande</span>
                  <span className={a.orderId}>#{formatNumeroCommandeStockHub(c.numero)}</span>
                  <span className={a.chipDelivered}>{LABELS_STATUT_COMMANDE_STOCK_HUB[c.statut]}</span>
                </header>

                <div className={a.orderBody}>
                  <div className={a.orderMain}>
                    <span className={a.orderThumb}>
                      <Box className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className={a.orderText}>
                      <div className={a.orderItem}>{c.titre}</div>
                      {c.sousTitre && <div className={a.orderDivision}>{c.sousTitre}</div>}
                    </div>
                    <div className={`${a.orderAmount} ${a.amountExpense}`}>
                      {formatMontantCommandeStockHub(c.montant)}
                    </div>
                  </div>

                  <dl className={a.orderMeta}>
                    <div className={a.metaCell}>
                      <dt className={a.metaKey}>Date</dt>
                      <dd className={a.metaVal}>{formatDate(c.dateCommande)}</dd>
                    </div>
                    <div className={a.metaCell}>
                      <dt className={a.metaKey}>Par</dt>
                      <dd className={a.metaVal}>{c.auteur?.nomComplet ?? "—"}</dd>
                    </div>
                    <div className={a.metaCell}>
                      <dt className={a.metaKey}>Paiement</dt>
                      <dd className={a.metaVal}>{c.modePaiement}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Rendue HORS de la carte, pour la même raison que dans
          TransactionsTable : le `backdrop-filter` de .card confinait le calque
          `fixed` à la carte. Ici c'était pire encore — la carte vit dans la
          colonne de 340 px, le formulaire y était comprimé en plus d'être
          rogné. */}
      {modalOuverte && (
        <Modal title="Nouvelle commande d'inventaire" onClose={fermer}>
          <form className="flex flex-col gap-4" onSubmit={soumettre} noValidate>
            <div className="form-grid">
              <Field label="Titre" required className="sm:col-span-2">
                <input
                  className="input-basic"
                  value={form.titre}
                  onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
                  placeholder="Rayonnage métallique lourd (x6)"
                />
              </Field>
              <Field label="Sous-titre" optional className="sm:col-span-2">
                <input
                  className="input-basic"
                  value={form.sousTitre}
                  onChange={(e) => setForm((f) => ({ ...f, sousTitre: e.target.value }))}
                  placeholder="Aménagement zone de stockage Casa"
                />
              </Field>
              <Field label="Montant" required>
                <Affix suffix="DH">
                  <input
                    className="input-bare"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0,00"
                    value={form.montant}
                    onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))}
                  />
                </Affix>
              </Field>
              <Field label="Statut" required>
                <select
                  className="input-basic"
                  value={form.statut}
                  onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
                >
                  {STATUTS_COMMANDE_STOCK_HUB.map((s) => (
                    <option key={s} value={s}>{LABELS_STATUT_COMMANDE_STOCK_HUB[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mode de paiement" required>
                <input
                  className="input-basic"
                  value={form.modePaiement}
                  onChange={(e) => setForm((f) => ({ ...f, modePaiement: e.target.value }))}
                  placeholder="Virement, espèces hub…"
                />
              </Field>
              <Field label="Date de commande" required>
                <input
                  className="input-basic"
                  type="date"
                  value={form.dateCommande}
                  onChange={(e) => setForm((f) => ({ ...f, dateCommande: e.target.value }))}
                />
              </Field>
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="form-actions">
              <button type="button" className="btn-outline" onClick={fermer} disabled={envoi}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={envoi}>
                {envoi ? "Création…" : "Créer la commande"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
