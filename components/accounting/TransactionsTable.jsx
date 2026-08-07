"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  CATEGORIES_TRANSACTION,
  LABELS_CATEGORIE_TRANSACTION,
  LABELS_TYPE_TRANSACTION,
  TYPES_TRANSACTION,
  formatMontantTransaction,
} from "@/lib/finance";
import a from "./Accounting.module.css";

const CHAMPS_VIDES = { montant: "", type: "revenu", categorie: "paiement_client", dateEffet: "", description: "" };

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TransactionsTable({ onMutate } = {}) {
  const [transactions, setTransactions] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [modalOuverte, setModalOuverte] = useState(false);
  const [form, setForm] = useState(CHAMPS_VIDES);
  const [formError, setFormError] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [annulationEnCours, setAnnulationEnCours] = useState(null);

  async function charger() {
    setChargement(true);
    try {
      const res = await apiGet("/api/finance");
      setTransactions(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    charger();
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) => {
      const categorieLabel = LABELS_CATEGORIE_TRANSACTION[t.categorie]?.toLowerCase() ?? "";
      const auteur = t.auteur?.nomComplet?.toLowerCase() ?? "";
      const description = t.description?.toLowerCase() ?? "";
      return categorieLabel.includes(q) || auteur.includes(q) || description.includes(q);
    });
  }, [transactions, query]);

  async function soumettre(e) {
    e.preventDefault();
    setFormError(null);

    const montant = Number(form.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      setFormError("Le montant doit être un nombre positif.");
      return;
    }
    if (!form.dateEffet) {
      setFormError("La date d'effet est requise.");
      return;
    }

    setEnvoi(true);
    try {
      await apiPost("/api/finance", {
        montant,
        type: form.type,
        categorie: form.categorie,
        dateEffet: new Date(form.dateEffet).toISOString(),
        description: form.description || undefined,
      });
      setModalOuverte(false);
      setForm(CHAMPS_VIDES);
      charger();
      onMutate?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler(transaction) {
    if (!window.confirm("Annuler cette transaction ? Une écriture de compensation sera créée, l'originale reste conservée pour l'audit.")) {
      return;
    }
    setAnnulationEnCours(transaction.id);
    try {
      await apiPost(`/api/finance/${transaction.id}/annuler`, {});
      charger();
      onMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setAnnulationEnCours(null);
    }
  }

  return (
    <section className={a.card}>
      <div className={a.tableHead}>
        <div>
          <h2 className={a.cardTitle}>Transactions</h2>
          <p className={a.cardSub}>Recettes et dépenses de l'entreprise.</p>
        </div>
        <div className={a.tableSearch}>
          <span className={a.searchIcon}>⌕</span>
          <input
            className={a.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une transaction…"
          />
        </div>
        <button className={a.btnPrimary} onClick={() => setModalOuverte(true)}>
          <span>+</span><span>Nouvelle transaction</span>
        </button>
      </div>

      {error && <p className={a.formError}>{error}</p>}

      <div className={a.tableScroll}>
        <div className={a.tableInner}>
          <div className={a.thead}>
            <div className={a.th}>Date</div>
            <div className={a.th}>Catégorie</div>
            <div className={a.th}>Auteur</div>
            <div className={a.th}>Montant</div>
            <div className={a.th}>Type</div>
            <div className={a.th}>Statut</div>
            <div className={a.thEnd}></div>
          </div>

          <div className={a.tbody}>
            {rows.map((t, i) => (
              <div key={t.id} className={`${a.tr} ${i % 2 ? a.trAlt : ""}`}>
                <div className={a.td}>{formatDate(t.dateEffet)}</div>
                <div className={a.tdName}>{LABELS_CATEGORIE_TRANSACTION[t.categorie]}</div>
                <div className={a.td}>{t.auteur?.nomComplet ?? "—"}</div>
                <div className={`${a.tdAmount} ${t.type === "revenu" ? a.amountRevenue : a.amountExpense}`}>
                  {formatMontantTransaction(t.montant, t.type)}
                </div>
                <div>
                  <span className={t.type === "revenu" ? a.chipRevenue : a.chipExpense}>
                    {LABELS_TYPE_TRANSACTION[t.type]}
                  </span>
                </div>
                <div>
                  {t.estAnnulee ? (
                    <span className={a.chipAnnulee}>Annulée</span>
                  ) : t.transactionOrigineId ? (
                    <span className={a.chipAnnulee}>Compensation</span>
                  ) : null}
                </div>
                <button
                  className={a.rowMenu}
                  onClick={() => annuler(t)}
                  disabled={t.estAnnulee || !!t.transactionOrigineId || annulationEnCours === t.id}
                  title="Annuler cette transaction (Avoir/Correction)"
                  aria-label="Annuler cette transaction"
                >
                  ↺
                </button>
              </div>
            ))}
            {!chargement && rows.length === 0 && (
              <p className={a.cardSub} style={{ padding: "16px 6px" }}>Aucune transaction.</p>
            )}
          </div>
        </div>
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
            <h2 className="text-lg font-bold">Nouvelle transaction</h2>

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
                <label className={a.formLabel}>Type</label>
                <select
                  className={a.formSelect}
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {TYPES_TRANSACTION.map((t) => (
                    <option key={t} value={t}>{LABELS_TYPE_TRANSACTION[t]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={a.formGrid}>
              <div className={a.formRow}>
                <label className={a.formLabel}>Catégorie</label>
                <select
                  className={a.formSelect}
                  value={form.categorie}
                  onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                >
                  {CATEGORIES_TRANSACTION.map((c) => (
                    <option key={c} value={c}>{LABELS_CATEGORIE_TRANSACTION[c]}</option>
                  ))}
                </select>
              </div>
              <div className={a.formRow}>
                <label className={a.formLabel}>Date d'effet</label>
                <input
                  className={a.formInput}
                  type="date"
                  value={form.dateEffet}
                  onChange={(e) => setForm((f) => ({ ...f, dateEffet: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className={a.formRow}>
              <label className={a.formLabel}>Description (optionnel)</label>
              <textarea
                className={a.formTextarea}
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
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
