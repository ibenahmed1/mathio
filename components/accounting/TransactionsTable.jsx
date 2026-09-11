"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Search } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { Affix, Field } from "@/components/form/Field";
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
    Promise.resolve().then(() => charger());
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

  const journalVide = !chargement && !error && transactions.length === 0;
  const aucunResultat = transactions.length > 0 && rows.length === 0;

  return (
    <>
      <section className={a.card}>
        <div className={a.tableHead}>
          <div className={a.tableTitle}>
            <h2 className={a.cardTitle}>Transactions</h2>
            <p className={a.cardSub}>Recettes et dépenses de l&apos;entreprise.</p>
          </div>
          {/* La recherche n'a rien à chercher dans un journal vide : elle
              n'apparaît qu'avec la première écriture. */}
          {transactions.length > 0 && (
            <div className={a.tableSearch}>
              <Search className={a.searchIcon} aria-hidden />
              <input
                className={a.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une transaction…"
                aria-label="Rechercher une transaction"
              />
            </div>
          )}
          <button type="button" className="btn-primary" onClick={ouvrir}>
            <Plus className="h-4 w-4" aria-hidden />
            Nouvelle transaction
          </button>
        </div>

        {error && <p className="form-error mt-3">{error}</p>}

        {/* Les états vides sont rendus HORS du conteneur défilant : posés
            dans .tableInner (620 px minimum), ils se retrouvaient décentrés et
            à moitié hors écran sur mobile, sous un en-tête de colonnes qui
            n'annonçait rien. */}
        {chargement && transactions.length === 0 ? (
          <div className="empty-state">Chargement du journal…</div>
        ) : journalVide ? (
          <div className="empty-state">
            <ArrowLeftRight size={28} className="opacity-40" aria-hidden />
            <p className="font-semibold text-black/70 dark:text-white/70">Aucune transaction</p>
            <p>Les recettes et dépenses saisies ici alimentent le rapport de trésorerie.</p>
            <button type="button" className="btn-outline btn-sm mt-2" onClick={ouvrir}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Saisir la première transaction
            </button>
          </div>
        ) : aucunResultat ? (
          <div className="empty-state">
            <p>Aucune transaction ne correspond à « {query.trim()} ».</p>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setQuery("")}>
              Effacer la recherche
            </button>
          </div>
        ) : rows.length > 0 ? (
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
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* La fenêtre est rendue HORS de la carte, et c'est ce qui la rend
          visible. .card porte un `backdrop-filter`, or cette propriété fait de
          la carte le bloc conteneur de ses descendants en `position: fixed` :
          rendu à l'intérieur, le calque « plein écran » ne couvrait que la
          carte. Sous un tableau rempli ça passait à peu près ; sur un journal
          vide la carte ne fait qu'une centaine de pixels et le formulaire y
          était rogné. Ne pas la replacer dans la <section>. */}
      {modalOuverte && (
        <Modal title="Nouvelle transaction" onClose={fermer}>
          <form className="flex flex-col gap-4" onSubmit={soumettre} noValidate>
            <div className="form-grid">
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
              <Field label="Type" required>
                <select
                  className="input-basic"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {TYPES_TRANSACTION.map((t) => (
                    <option key={t} value={t}>{LABELS_TYPE_TRANSACTION[t]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Catégorie" required>
                <select
                  className="input-basic"
                  value={form.categorie}
                  onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                >
                  {CATEGORIES_TRANSACTION.map((c) => (
                    <option key={c} value={c}>{LABELS_CATEGORIE_TRANSACTION[c]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date d'effet" required>
                <input
                  className="input-basic"
                  type="date"
                  value={form.dateEffet}
                  onChange={(e) => setForm((f) => ({ ...f, dateEffet: e.target.value }))}
                />
              </Field>
              <Field label="Description" optional className="sm:col-span-2">
                <textarea
                  className="input-basic"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Référence, justificatif, contexte…"
                />
              </Field>
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="form-actions">
              <button type="button" className="btn-outline" onClick={fermer} disabled={envoi}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={envoi}>
                {envoi ? "Création…" : "Créer la transaction"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
