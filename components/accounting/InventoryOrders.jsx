"use client";

import { useEffect, useImperativeHandle, useState } from "react";
import { Box, History, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { Affix, Field } from "@/components/form/Field";
import { ChampPreuve, ModalePreuve, PreuveExistante, usePreuveComptable } from "./PreuveComptable";
import { useCategoriesComptables } from "./Categories";
import { ModaleHistorique } from "./Historique";
import { LONGUEUR_MAX_TITRE } from "@/lib/finance";
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
  categorieId: "",
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Jour LOCAL pour un <input type="date"> — même raison que dans TransactionsTable.
function versChampDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formulaireDepuis(c) {
  return {
    titre: c.titre,
    sousTitre: c.sousTitre ?? "",
    montant: String(c.montant),
    statut: c.statut,
    modePaiement: c.modePaiement,
    dateCommande: versChampDate(c.dateCommande),
    categorieId: c.categorie?.id ?? "",
  };
}

// Pilotée depuis la barre du haut de page (ComptabiliteBoard), comme le
// journal : `corbeille` choisit la vue, `ref.ouvrirCreation()` sert le bouton
// « Nouvelle commande ».
export default function InventoryOrders({
  ref,
  corbeille = false,
  jetonCategories = 0,
  peutModifier = false,
  peutSupprimer = false,
} = {}) {
  const [commandes, setCommandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [error, setError] = useState(null);
  // `null` = fermée ; `{ commande: null }` = création ; `{ commande }` = modification.
  const [edition, setEdition] = useState(null);
  const [form, setForm] = useState(CHAMPS_VIDES);
  const [formError, setFormError] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [actionEnCours, setActionEnCours] = useState(null);
  // Justificatif de la commande en cours de saisie : facultatif — la facture du
  // fournisseur arrive rarement en même temps que la commande.
  const preuve = usePreuveComptable();
  const [retirerPreuve, setRetirerPreuve] = useState(false);
  // Commande dont on regarde le justificatif. La photo n'est PAS dans la liste :
  // ce qu'on ouvre est la route de contenu
  // (§ /api/commandes-stock-hub/[id]/preuve).
  const [apercu, setApercu] = useState(null);
  const [historique, setHistorique] = useState(null);
  const { categories } = useCategoriesComptables("commande_stock_hub", jetonCategories);

  const [jetonChargement, setJetonChargement] = useState(0);
  const charger = () => setJetonChargement((v) => v + 1);

  useEffect(() => {
    let actif = true;
    Promise.resolve().then(async () => {
      setChargement(true);
      try {
        const res = await apiGet(corbeille ? "/api/commandes-stock-hub?supprimees=1" : "/api/commandes-stock-hub");
        if (actif) {
          setCommandes(res.data ?? []);
          setError(null);
        }
      } catch (err) {
        if (actif) setError(err instanceof Error ? err.message : "Erreur");
      } finally {
        if (actif) setChargement(false);
      }
    });
    return () => {
      actif = false;
    };
  }, [corbeille, jetonChargement, jetonCategories]);

  function ouvrirCreation() {
    setForm(CHAMPS_VIDES);
    preuve.reinitialiser();
    setRetirerPreuve(false);
    setFormError(null);
    setEdition({ commande: null });
  }

  useImperativeHandle(ref, () => ({ ouvrirCreation }));

  function ouvrirModification(c) {
    setForm(formulaireDepuis(c));
    preuve.reinitialiser();
    setRetirerPreuve(false);
    setFormError(null);
    setEdition({ commande: c });
  }

  // Pas de fermeture pendant l'envoi : la fenêtre disparaîtrait avant que
  // l'erreur éventuelle de l'API ait un endroit où s'afficher.
  function fermer() {
    if (!envoi) setEdition(null);
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

    const existante = edition?.commande;
    setEnvoi(true);
    try {
      if (!existante) {
        await apiPost("/api/commandes-stock-hub", {
          titre: form.titre.trim(),
          sousTitre: form.sousTitre.trim() || undefined,
          montant,
          statut: form.statut,
          modePaiement: form.modePaiement.trim(),
          dateCommande: new Date(form.dateCommande).toISOString(),
          categorieId: form.categorieId || undefined,
          preuveUrl: preuve.corps,
        });
      } else {
        // Seuls les champs changés partent — cf. TransactionsTable. Le statut
        // n'en fait jamais partie : il a son menu et sa route.
        const initial = formulaireDepuis(existante);
        const corps = {};
        if (form.titre.trim() !== initial.titre) corps.titre = form.titre.trim();
        if (form.sousTitre.trim() !== initial.sousTitre.trim()) corps.sousTitre = form.sousTitre;
        if (montant !== Number(initial.montant)) corps.montant = montant;
        if (form.modePaiement.trim() !== initial.modePaiement) corps.modePaiement = form.modePaiement.trim();
        if (form.dateCommande !== initial.dateCommande) corps.dateCommande = new Date(form.dateCommande).toISOString();
        if (form.categorieId !== initial.categorieId) corps.categorieId = form.categorieId || null;
        if (preuve.corps) corps.preuveUrl = preuve.corps;
        else if (retirerPreuve) corps.preuveUrl = null;

        if (Object.keys(corps).length === 0) {
          setEdition(null);
          return;
        }
        await apiPatch(`/api/commandes-stock-hub/${existante.id}`, corps);
      }
      setEdition(null);
      preuve.reinitialiser();
      charger();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  async function agir(commande, action) {
    setActionEnCours(commande.id);
    setError(null);
    try {
      await action();
      charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionEnCours(null);
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

    setActionEnCours(commande.id);
    setError(null);
    try {
      const maj = await apiPatch(`/api/commandes-stock-hub/${commande.id}/statut`, { statut: vers });
      setCommandes((prev) => prev.map((c) => (c.id === commande.id ? { ...c, statut: maj.statut } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionEnCours(null);
    }
  }

  function supprimer(c) {
    const numero = formatNumeroCommandeStockHub(c.numero);
    if (!window.confirm(`Supprimer la commande ${numero} « ${c.titre} » ?\n\nElle restera restaurable depuis la corbeille.`)) {
      return;
    }
    agir(c, () => apiDelete(`/api/commandes-stock-hub/${c.id}`));
  }

  const existante = edition?.commande ?? null;
  const listeVide = !chargement && !error && commandes.length === 0;

  return (
    <>
      <section className={a.card}>
        <div className={a.cardHead}>
          <div className={a.tableTitle}>
            <h2 className={a.cardTitle}>{corbeille ? "Commandes supprimées" : "Commandes d'inventaire"}</h2>
            <p className={a.cardSub}>{corbeille ? "Hors liste, restaurables" : "Approvisionnement des hubs"}</p>
          </div>
        </div>

        {error && <p className="form-error mt-3">{error}</p>}

        {chargement && commandes.length === 0 ? (
          <div className="empty-state">Chargement…</div>
        ) : listeVide && corbeille ? (
          <div className="empty-state">La corbeille est vide.</div>
        ) : listeVide ? (
          <div className="empty-state">
            <Box size={28} className="opacity-40" aria-hidden />
            <p className="font-semibold text-black/70 dark:text-white/70">Aucune commande d&apos;inventaire</p>
            <p>Achats de matériel et d&apos;aménagement pour les hubs.</p>
            <button type="button" className="btn-outline btn-sm mt-2" onClick={ouvrirCreation}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Ajouter une commande
            </button>
          </div>
        ) : (
          <div className={a.orderList}>
            {commandes.map((c) => {
              const numero = formatNumeroCommandeStockHub(c.numero);
              const suivants = corbeille ? [] : statutsSuivantsCommandeStockHub(c.statut);
              const teinte = `${a.statutChip} ${a[`statut_${c.statut}`] ?? ""}`;
              return (
                <article key={c.id} className={a.order}>
                  <header className={a.orderHead}>
                    <span className={a.orderLabel}>Commande</span>
                    <span className={a.orderId}>#{numero}</span>
                    {/* Le trombone est posé contre la référence du bordereau :
                        c'est de CE document qu'il est la pièce. `c.preuve` est
                        un chemin vers la route de contenu, pas l'image. */}
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
                        — ou une commande à la corbeille — reste une pastille. */}
                    {suivants.length > 0 ? (
                      <select
                        className={`${teinte} ${a.statutSelect}`}
                        value={c.statut}
                        onChange={(e) => changerStatut(c, e.target.value)}
                        disabled={actionEnCours === c.id}
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
                        {(c.sousTitre || c.categorie) && (
                          <div className={a.orderDivision}>
                            {[c.categorie?.nom, c.sousTitre].filter(Boolean).join(" · ")}
                          </div>
                        )}
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
                        <dt className={a.metaKey}>{corbeille ? "Suppr." : "Par"}</dt>
                        <dd className={a.metaVal}>
                          {corbeille ? formatDate(c.supprimeLe) : c.auteur?.nomComplet ?? "—"}
                        </dd>
                      </div>
                      <div className={a.metaCell}>
                        <dt className={a.metaKey}>Paiement</dt>
                        <dd className={a.metaVal}>{c.modePaiement}</dd>
                      </div>
                    </dl>

                    {/* Actions en toutes lettres, au pied de la carte qu'elles
                        visent : pas d'icône à deviner. */}
                    <div className={a.orderActions}>
                      {corbeille ? (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => agir(c, () => apiPost(`/api/commandes-stock-hub/${c.id}/restaurer`, {}))}
                          disabled={actionEnCours === c.id}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          Restaurer
                        </button>
                      ) : (
                        peutModifier && (
                          <button
                            type="button"
                            className="btn-outline btn-sm"
                            onClick={() => ouvrirModification(c)}
                            disabled={actionEnCours === c.id}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Modifier
                          </button>
                        )
                      )}
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setHistorique(c)}>
                        <History className="h-3.5 w-3.5" aria-hidden />
                        Historique
                      </button>
                      {!corbeille && peutSupprimer && (
                        <button
                          type="button"
                          className={`btn-ghost btn-sm ${a.actionDanger}`}
                          onClick={() => supprimer(c)}
                          disabled={actionEnCours === c.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Rendue HORS de la carte, pour la même raison que dans
          TransactionsTable : le `backdrop-filter` de .card confinait le calque
          `fixed` à la carte — et la carte vit dans la colonne de 340 px. */}
      {edition && (
        <Modal
          title={existante ? `Modifier la commande #${formatNumeroCommandeStockHub(existante.numero)}` : "Nouvelle commande d'inventaire"}
          size="xl"
          onClose={fermer}
        >
          <form className="flex flex-col gap-4" onSubmit={soumettre} noValidate>
            <div className="form-grid">
              <Field label="Titre" required className="sm:col-span-2">
                <input
                  className="input-basic"
                  value={form.titre}
                  maxLength={LONGUEUR_MAX_TITRE}
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
              {/* À la création seulement : ensuite, le statut avance par le
                  menu de la carte. « Annulée » n'est pas proposée. */}
              {!existante && (
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
              )}
              <Field label="Catégorie" optional>
                <select
                  className="input-basic"
                  value={form.categorieId}
                  onChange={(e) => setForm((f) => ({ ...f, categorieId: e.target.value }))}
                >
                  <option value="">Sans catégorie</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.nom}</option>
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

              {existante?.preuve && !preuve.corps && (
                <PreuveExistante
                  retire={retirerPreuve}
                  onBasculer={() => setRetirerPreuve((v) => !v)}
                  onVoir={() => setApercu(existante)}
                />
              )}
              {/* Facture du fournisseur ou bon de livraison signé : le même
                  champ que sur les écritures du journal, avec l'invite du
                  document qu'on cherche vraiment ici. */}
              <ChampPreuve
                etat={preuve}
                libelle={existante?.preuve ? "Remplacer le justificatif" : "Justificatif (facture, bon de livraison)"}
                invite="Photographier ou déposer la facture"
              />
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="form-actions">
              <button type="button" className="btn-outline" onClick={fermer} disabled={envoi}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={envoi}>
                {existante
                  ? envoi ? "Enregistrement…" : "Enregistrer"
                  : envoi ? "Création…" : "Créer la commande"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {apercu && (
        <ModalePreuve
          url={apercu.preuve}
          legende={`Commande #${formatNumeroCommandeStockHub(apercu.numero)} · ${apercu.titre} · ${formatMontantCommandeStockHub(apercu.montant)}`}
          onClose={() => setApercu(null)}
        />
      )}

      {historique && (
        <ModaleHistorique
          cible="commande_stock_hub"
          id={historique.id}
          titre={`Commande #${formatNumeroCommandeStockHub(historique.numero)}`}
          onClose={() => setHistorique(null)}
        />
      )}
    </>
  );
}
