"use client";

import { useEffect, useState } from "react";
import { Box, Paperclip, Plus } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { Affix, Field } from "@/components/form/Field";
import { ChampPreuve, ModalePreuve, usePreuveComptable } from "./PreuveComptable";
import {
  LABELS_STATUT_COMMANDE_STOCK_HUB,
  STATUTS_CREATION_COMMANDE_STOCK_HUB,
  STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT,
  formatMontantCommandeStockHub,
  formatNumeroCommandeStockHub,
  statutsSuivantsCommandeStockHub,
} from "@/lib/commandes-stock-hub";
import a from "./Accounting.module.css";

const CHAMPS_VIDES = {
  titre: "",
  sousTitre: "",
  montant: "",
  statut: STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT,
  modePaiement: "",
  dateCommande: "",
};

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
  const [statutEnCours, setStatutEnCours] = useState(null);
  // Justificatif de la commande en cours de saisie : facultatif — la facture du
  // fournisseur arrive rarement en même temps que la commande.
  const preuve = usePreuveComptable();
  // Commande dont on regarde le justificatif. La photo n'est PAS dans la liste :
  // ce qu'on ouvre est la route de contenu
  // (§ /api/commandes-stock-hub/[id]/preuve).
  const [apercu, setApercu] = useState(null);

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
        preuveUrl: preuve.corps,
      });
      setModalOuverte(false);
      setForm(CHAMPS_VIDES);
      preuve.reinitialiser();
      charger();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  async function changerStatut(commande, vers) {
    if (vers === commande.statut) return;
    const numero = formatNumeroCommandeStockHub(commande.numero);
    // « Reçue » et « Annulée » sont définitives (lib/commandes-stock-hub.ts) :
    // une confirmation, parce qu'un menu déroulant se change par mégarde. Si
    // elle est refusée, le <select> contrôlé revient seul sur le statut actuel.
    const definitif = statutsSuivantsCommandeStockHub(vers).length === 0;
    if (
      definitif &&
      !window.confirm(`Passer la commande ${numero} à « ${LABELS_STATUT_COMMANDE_STOCK_HUB[vers]} » ? Ce statut est définitif.`)
    ) {
      return;
    }

    setStatutEnCours(commande.id);
    setError(null);
    try {
      const maj = await apiPatch(`/api/commandes-stock-hub/${commande.id}`, { statut: vers });
      setCommandes((prev) => prev.map((c) => (c.id === commande.id ? { ...c, statut: maj.statut } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setStatutEnCours(null);
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
            {commandes.map((c) => {
              const numero = formatNumeroCommandeStockHub(c.numero);
              const suivants = statutsSuivantsCommandeStockHub(c.statut);
              const teinte = `${a.statutChip} ${a[`statut_${c.statut}`] ?? ""}`;
              return (
                <article key={c.id} className={a.order}>
                  <header className={a.orderHead}>
                    <span className={a.orderLabel}>Commande</span>
                    <span className={a.orderId}>#{numero}</span>
                    {/* Le trombone est posé contre la référence du bordereau, et
                        pas dans le pied de la carte : c'est de CE document qu'il
                        est la pièce. `c.preuve` est un chemin vers la route de
                        contenu, pas l'image — la liste ne transporte pas les
                        photos (§ GET /api/commandes-stock-hub). */}
                    {c.preuve && (
                      <button
                        type="button"
                        className={a.preuveBtn}
                        onClick={() => setApercu(c)}
                        title="Voir le justificatif"
                        aria-label={`Voir le justificatif de la commande ${numero}`}
                      >
                        <Paperclip className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                    {/* Tant qu'une étape suivante existe, la pastille EST le
                        menu qui fait avancer la commande. Un statut définitif
                        reste une simple pastille : un menu à une seule option
                        ferait croire qu'on peut encore agir. */}
                    {suivants.length > 0 ? (
                      <select
                        className={`${teinte} ${a.statutSelect}`}
                        value={c.statut}
                        onChange={(e) => changerStatut(c, e.target.value)}
                        disabled={statutEnCours === c.id}
                        aria-label={`Statut de la commande ${numero}`}
                      >
                        <option value={c.statut}>{LABELS_STATUT_COMMANDE_STOCK_HUB[c.statut]}</option>
                        {suivants.map((s) => (
                          <option key={s} value={s}>
                            {`→ ${LABELS_STATUT_COMMANDE_STOCK_HUB[s]}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={teinte}>{LABELS_STATUT_COMMANDE_STOCK_HUB[c.statut]}</span>
                    )}
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
              );
            })}
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
              {/* « Annulée » n'est pas proposée : elle ne s'atteint qu'en
                  faisant avancer une commande existante. */}
              <Field label="Statut" required>
                <select
                  className="input-basic"
                  value={form.statut}
                  onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
                >
                  {STATUTS_CREATION_COMMANDE_STOCK_HUB.map((s) => (
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

              {/* Facture du fournisseur ou bon de livraison signé : le même
                  champ que sur les écritures du journal, avec l'invite du
                  document qu'on cherche vraiment ici. */}
              <ChampPreuve
                etat={preuve}
                libelle="Justificatif (facture, bon de livraison)"
                invite="Photographier ou déposer la facture"
              />
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

      {/* Visionneuse du justificatif d'une commande déjà enregistrée. Hors de la
          carte, comme le formulaire ci-dessus. */}
      {apercu && (
        <ModalePreuve
          url={apercu.preuve}
          legende={`Commande #${formatNumeroCommandeStockHub(apercu.numero)} · ${apercu.titre} · ${formatMontantCommandeStockHub(apercu.montant)}`}
          onClose={() => setApercu(null)}
        />
      )}
    </>
  );
}
