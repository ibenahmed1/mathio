"use client";

import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
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

  return (
    <section className={a.card}>
      <div className={a.cardHead}>
        <div>
          <h2 className={a.cardTitle}>Commandes d&apos;inventaire</h2>
          <p className={a.cardSub}>Approvisionnement des hubs</p>
        </div>
        <button className={a.selectBtn} onClick={() => setModalOuverte(true)}>
          <span>+ Ajouter</span>
        </button>
      </div>

      {error && <p className={a.formError}>{error}</p>}

      <div className={a.orderList}>
        {!chargement && commandes.length === 0 && (
          <p className={a.cardSub} style={{ padding: "16px 6px" }}>Aucune commande d&apos;inventaire.</p>
        )}

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

      {modalOuverte && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setModalOuverte(false)}
        >
          <form
            className="flex w-full max-w-md flex-col gap-4 rounded-lg bg-white p-5 dark:bg-black"
            onClick={(e) => e.stopPropagation()}
            onSubmit={soumettre}
          >
            <h2 className="text-lg font-bold">Nouvelle commande d&apos;inventaire</h2>

            <div className={a.formRow}>
              <label className={a.formLabel}>Titre</label>
              <input
                className={a.formInput}
                value={form.titre}
                onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
                placeholder="Rayonnage Métallique Lourd (x6)"
                required
              />
            </div>

            <div className={a.formRow}>
              <label className={a.formLabel}>Sous-titre (optionnel)</label>
              <input
                className={a.formInput}
                value={form.sousTitre}
                onChange={(e) => setForm((f) => ({ ...f, sousTitre: e.target.value }))}
                placeholder="Aménagement Zone de Stockage Casa"
              />
            </div>

            <div className={a.formGrid}>
              <div className={a.formRow}>
                <label className={a.formLabel}>Montant (DH)</label>
                <input
                  className={a.formInput}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.montant}
                  onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))}
                  required
                />
              </div>
              <div className={a.formRow}>
                <label className={a.formLabel}>Statut</label>
                <select
                  className={a.formSelect}
                  value={form.statut}
                  onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
                >
                  {STATUTS_COMMANDE_STOCK_HUB.map((s) => (
                    <option key={s} value={s}>{LABELS_STATUT_COMMANDE_STOCK_HUB[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={a.formGrid}>
              <div className={a.formRow}>
                <label className={a.formLabel}>Mode de paiement</label>
                <input
                  className={a.formInput}
                  value={form.modePaiement}
                  onChange={(e) => setForm((f) => ({ ...f, modePaiement: e.target.value }))}
                  placeholder="Virement Bancaire, Espèces Hub…"
                  required
                />
              </div>
              <div className={a.formRow}>
                <label className={a.formLabel}>Date de commande</label>
                <input
                  className={a.formInput}
                  type="date"
                  value={form.dateCommande}
                  onChange={(e) => setForm((f) => ({ ...f, dateCommande: e.target.value }))}
                  required
                />
              </div>
            </div>

            {formError && <p className={a.formError}>{formError}</p>}

            <div className={a.formActions}>
              <button type="button" className={a.btnSecondary} onClick={() => setModalOuverte(false)}>
                Annuler
              </button>
              <button type="submit" className={a.btnPrimary} disabled={envoi}>
                {envoi ? "Création…" : "Créer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
