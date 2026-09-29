"use client";

import { useEffect, useImperativeHandle, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronRight, Paperclip, Plus, Search, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { Affix, Field } from "@/components/form/Field";
import { ChampPreuve, ModalePreuve, PreuveExistante, usePreuveComptable } from "./PreuveComptable";
import { useCategoriesComptables } from "./Categories";
import { DetailTransaction } from "./DetailTransaction";
import { LABELS_TYPE_TRANSACTION, LONGUEUR_MAX_TITRE, TYPES_TRANSACTION, formatMontantTransaction } from "@/lib/finance";
import a from "./Accounting.module.css";

const CHAMPS_VIDES = { titre: "", montant: "", type: "revenu", categorieId: "", dateEffet: "", description: "" };

const LIBELLES_ORIGINE = { tournee: "la tournée", facture: "la facture", paie: "le bon de paie" };
// Badge d'une écriture AUTOMATIQUE : le document qui l'a produite, en clair —
// « Auto » seul ne disait ni d'où elle venait, ni pourquoi s'en méfier.
const LIBELLES_BADGE_ORIGINE = { tournee: "Tournée", facture: "Facture", paie: "Paie" };

// Filtre par sens, appliqué côté écran : le journal est déjà chargé en entier
// (les totaux du rapport en dépendent), refaire un aller-retour serait inutile.
const FILTRES_TYPE = [
  { valeur: "tout", libelle: "Tout" },
  { valeur: "revenu", libelle: "Recettes" },
  { valeur: "depense", libelle: "Dépenses" },
];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Valeur d'un <input type="date"> : le jour LOCAL, pas celui d'UTC — une
// écriture saisie à 00 h 30 à Casablanca ne doit pas s'afficher la veille.
function versChampDate(iso) {
  const d = new Date(iso);
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

function formulaireDepuis(t) {
  return {
    titre: t.titre,
    montant: String(t.montant),
    type: t.type,
    categorieId: t.categorie?.id ?? "",
    dateEffet: versChampDate(t.dateEffet),
    description: t.description ?? "",
  };
}

/**
 * Journal des écritures.
 *
 * Un clic sur une ligne (ou Entrée au clavier) ouvre sa FICHE : on consulte
 * d'abord, et les actions — modifier, annuler, supprimer, restaurer — sont en
 * tête de cette fiche, en toutes lettres (DetailTransaction).
 *
 * Pilotée depuis la barre du haut de page (ComptabiliteBoard) :
 *   - `corbeille` : journal ou écritures supprimées ;
 *   - `ref.ouvrirCreation()` : le bouton « Nouvelle transaction ».
 */
export default function TransactionsTable({
  ref,
  corbeille = false,
  onMutate,
  jetonCategories = 0,
  peutModifier = false,
  peutSupprimer = false,
} = {}) {
  const [transactions, setTransactions] = useState([]);
  const [query, setQuery] = useState("");
  const [filtreType, setFiltreType] = useState("tout");
  const [error, setError] = useState(null);
  const [chargement, setChargement] = useState(true);
  // Écriture dont la fiche est ouverte. Un identifiant et non l'objet : la
  // fiche relit la ligne dans le journal rechargé, elle reste donc à jour
  // après une modification — et se ferme seule si l'écriture quitte la vue.
  const [detailId, setDetailId] = useState(null);
  // `null` = fenêtre fermée ; `{ transaction: null }` = création ;
  // `{ transaction }` = modification de cette écriture.
  const [edition, setEdition] = useState(null);
  const [form, setForm] = useState(CHAMPS_VIDES);
  const [formError, setFormError] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [actionEnCours, setActionEnCours] = useState(false);
  // Justificatif en cours de saisie : facultatif, tenu hors du formulaire parce
  // qu'il vit dans un état différent (lecture du fichier en cours, refus du
  // format) et qu'il ne se remet pas à zéro au même moment.
  const preuve = usePreuveComptable();
  // En modification : le justificatif déjà enregistré doit-il partir ?
  const [retirerPreuve, setRetirerPreuve] = useState(false);
  // Écriture dont on regarde le justificatif. La photo n'est PAS dans le
  // journal : ce qu'on ouvre est la route de contenu (§ /api/finance/[id]/preuve).
  const [apercu, setApercu] = useState(null);
  const { categories } = useCategoriesComptables("transaction", jetonCategories);

  // Recharger = incrémenter ce compteur : l'effet ci-dessous lit la vue ET le
  // compteur, sans fonction de chargement à déclarer en dépendance.
  const [jetonChargement, setJetonChargement] = useState(0);
  const charger = () => setJetonChargement((v) => v + 1);

  useEffect(() => {
    let actif = true;
    Promise.resolve().then(async () => {
      setChargement(true);
      try {
        const res = await apiGet(corbeille ? "/api/finance?supprimees=1" : "/api/finance");
        if (actif) {
          setTransactions(res.data);
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

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (filtreType !== "tout" && t.type !== filtreType) return false;
      if (!q) return true;
      return [t.titre, t.categorie?.nom, t.auteur?.nomComplet, t.description, t.origine?.numero]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [transactions, query, filtreType]);

  const detail = transactions.find((t) => t.id === detailId) ?? null;
  // L'autre moitié d'un couple annulation / compensation, si elle est chargée.
  const detailLiee = detail
    ? transactions.find((t) =>
        detail.transactionOrigineId ? t.id === detail.transactionOrigineId : t.transactionOrigineId === detail.id
      ) ?? null
    : null;

  function ouvrirCreation() {
    setForm({ ...CHAMPS_VIDES, categorieId: categories[0]?.id ?? "" });
    preuve.reinitialiser();
    setRetirerPreuve(false);
    setFormError(null);
    setEdition({ transaction: null });
  }

  useImperativeHandle(ref, () => ({ ouvrirCreation }));

  function ouvrirModification(t) {
    setForm(formulaireDepuis(t));
    preuve.reinitialiser();
    setRetirerPreuve(false);
    setFormError(null);
    setEdition({ transaction: t });
  }

  // Pas de fermeture pendant l'envoi : la fenêtre disparaîtrait avant que
  // l'erreur éventuelle de l'API ait un endroit où s'afficher.
  function fermer() {
    if (!envoi) setEdition(null);
  }

  function apresMutation() {
    charger();
    onMutate?.();
  }

  async function soumettre(e) {
    e.preventDefault();
    setFormError(null);

    const montant = Number(form.montant);
    if (!form.titre.trim()) {
      setFormError("Le titre est requis.");
      return;
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      setFormError("Le montant doit être un nombre positif.");
      return;
    }
    if (!form.dateEffet) {
      setFormError("La date d'effet est requise.");
      return;
    }
    if (!form.categorieId) {
      setFormError("La catégorie est requise.");
      return;
    }

    const existante = edition?.transaction;
    setEnvoi(true);
    try {
      if (!existante) {
        await apiPost("/api/finance", {
          titre: form.titre.trim(),
          montant,
          type: form.type,
          categorieId: form.categorieId,
          dateEffet: new Date(form.dateEffet).toISOString(),
          description: form.description || undefined,
          preuveUrl: preuve.corps,
        });
      } else {
        // Seuls les champs CHANGÉS partent : renvoyer la date telle quelle
        // la ramènerait à minuit et l'historique noterait une modification
        // que personne n'a faite.
        const initial = formulaireDepuis(existante);
        const corps = {};
        if (form.titre.trim() !== initial.titre) corps.titre = form.titre.trim();
        if (montant !== Number(initial.montant)) corps.montant = montant;
        if (form.type !== initial.type) corps.type = form.type;
        if (form.categorieId !== initial.categorieId) corps.categorieId = form.categorieId;
        if (form.dateEffet !== initial.dateEffet) corps.dateEffet = new Date(form.dateEffet).toISOString();
        if (form.description.trim() !== initial.description.trim()) corps.description = form.description;
        if (preuve.corps) corps.preuveUrl = preuve.corps;
        else if (retirerPreuve) corps.preuveUrl = null;

        if (Object.keys(corps).length === 0) {
          setEdition(null);
          return;
        }
        await apiPatch(`/api/finance/${existante.id}`, corps);
      }
      setEdition(null);
      preuve.reinitialiser();
      apresMutation();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  async function agir(action) {
    setActionEnCours(true);
    setError(null);
    try {
      await action();
      apresMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setActionEnCours(false);
    }
  }

  function annuler(t) {
    if (!window.confirm(`Neutraliser « ${t.titre} » ?\n\nUne écriture inverse de même montant sera ajoutée au journal : l'effet sur le solde devient nul. L'originale reste visible, marquée « Neutralisée ».`)) {
      return;
    }
    agir(() => apiPost(`/api/finance/${t.id}/annuler`, {}));
  }

  function supprimer(t) {
    const consequences = [
      t.estAnnulee && "Son écriture de neutralisation sera supprimée avec elle.",
      t.transactionOrigineId && "L'écriture qu'elle neutralise redeviendra active.",
      t.origine && `Elle a été générée par ${LIBELLES_ORIGINE[t.origine.type]} ${t.origine.numero}, qui ne sera pas modifié(e).`,
    ].filter(Boolean);
    const message = [
      `Supprimer « ${t.titre} » ?`,
      "Elle sortira du journal et des totaux, et restera restaurable depuis la corbeille.",
      ...consequences,
    ].join("\n\n");
    if (!window.confirm(message)) return;
    agir(() => apiDelete(`/api/finance/${t.id}`));
  }

  function restaurer(t) {
    agir(() => apiPost(`/api/finance/${t.id}/restaurer`, {}));
  }


  const existante = edition?.transaction ?? null;
  // Une compensation suit son origine : montant et sens verrouillés
  // (lib/journal-comptable.ts, refusModificationCompensation).
  const verrouMontant = !!existante?.transactionOrigineId;
  const journalVide = !chargement && !error && transactions.length === 0;
  const aucunResultat = transactions.length > 0 && rows.length === 0;

  return (
    <>
      <section className={a.card}>
        <div className={a.tableHead}>
          <div className={a.tableTitle}>
            <h2 className={a.cardTitle}>{corbeille ? "Corbeille des transactions" : "Transactions"}</h2>
            <p className={a.cardSub}>
              {corbeille
                ? "Écritures supprimées : hors journal et hors totaux, restaurables."
                : `${rows.length} écriture${rows.length > 1 ? "s" : ""}${rows.length !== transactions.length ? ` sur ${transactions.length}` : ""}`}
            </p>
          </div>
          {transactions.length > 0 && (
            <>
              <div className={a.filtres} role="group" aria-label="Filtrer par type">
                {FILTRES_TYPE.map((f) => (
                  <button
                    key={f.valeur}
                    type="button"
                    className={filtreType === f.valeur ? a.filtreActif : a.filtre}
                    aria-pressed={filtreType === f.valeur}
                    onClick={() => setFiltreType(f.valeur)}
                  >
                    {f.libelle}
                  </button>
                ))}
              </div>
              <div className={a.tableSearch}>
                <Search className={a.searchIcon} aria-hidden />
                <input
                  className={a.searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Titre, catégorie, auteur, n° de document…"
                  aria-label="Rechercher une transaction"
                />
              </div>
            </>
          )}
        </div>

        {error && <p className="form-error mt-3">{error}</p>}

        {/* Les états vides sont rendus HORS du conteneur défilant : posés
            dans .tableInner, ils se retrouvaient décentrés et à moitié hors
            écran sur mobile, sous un en-tête de colonnes qui n'annonçait rien. */}
        {chargement && transactions.length === 0 ? (
          <div className="empty-state">Chargement du journal…</div>
        ) : journalVide && corbeille ? (
          <div className="empty-state">
            <Trash2 size={28} className="opacity-40" aria-hidden />
            <p>La corbeille est vide.</p>
          </div>
        ) : journalVide ? (
          <div className="empty-state">
            <ArrowLeftRight size={28} className="opacity-40" aria-hidden />
            <p className="font-semibold text-black/70 dark:text-white/70">Aucune transaction</p>
            <p>Les recettes et dépenses saisies ici alimentent le rapport de trésorerie.</p>
            <button type="button" className="btn-outline btn-sm mt-2" onClick={ouvrirCreation}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Saisir la première transaction
            </button>
          </div>
        ) : aucunResultat ? (
          <div className="empty-state">
            <p>Aucune transaction ne correspond à ces critères.</p>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setQuery("");
                setFiltreType("tout");
              }}
            >
              Effacer les filtres
            </button>
          </div>
        ) : rows.length > 0 ? (
          <div className={a.tableScroll}>
            <div className={a.tableInner}>
              <div className={a.thead}>
                <div className={a.th}>Date</div>
                <div className={a.th}>Transaction</div>
                <div className={a.th}>Auteur</div>
                <div className={a.th}>Type</div>
                <div className={a.th}>État</div>
                <div className={a.thCenter}>Preuve</div>
                <div className={a.thEnd}>Montant</div>
                <div aria-hidden />
              </div>

              <div className={a.tbody}>
                {rows.map((t) => {
                  const ouverte = t.id === detailId;
                  return (
                    <div
                      key={t.id}
                      className={`${a.tr} ${ouverte ? a.trSelection : ""}`}
                      role="button"
                      tabIndex={0}
                      title="Voir le détail"
                      aria-label={`Voir le détail : ${t.titre}, ${formatMontantTransaction(t.montant, t.type)}, le ${formatDate(t.dateEffet)}`}
                      onClick={() => setDetailId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDetailId(t.id);
                        }
                      }}
                    >
                      <div className={a.td}>{formatDate(t.dateEffet)}</div>
                      <div className="min-w-0">
                        <div className={a.tdName} title={t.description ?? t.titre}>{t.titre}</div>
                        <div className={a.tdSub}>
                          {t.categorie?.nom}
                          {t.origine && (
                            <span className={a.chipAuto} title={`Générée par ${LIBELLES_ORIGINE[t.origine.type]} ${t.origine.numero}`}>
                              {LIBELLES_BADGE_ORIGINE[t.origine.type]} {t.origine.numero}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={a.td}>{t.auteur?.nomComplet ?? "—"}</div>
                      <div>
                        <span className={t.type === "revenu" ? a.chipRevenue : a.chipExpense}>
                          {LABELS_TYPE_TRANSACTION[t.type]}
                        </span>
                      </div>
                      <div>
                        {corbeille ? (
                          <span className={a.chipAnnulee} title={t.supprimePar ? `par ${t.supprimePar.nomComplet}` : undefined}>
                            Supprimée le {formatDate(t.supprimeLe)}
                          </span>
                        ) : t.estAnnulee ? (
                          <span className={a.chipAnnulee}>Neutralisée</span>
                        ) : t.transactionOrigineId ? (
                          <span className={a.chipAnnulee}>Neutralisation</span>
                        ) : (
                          <span className={a.etatActif}>Active</span>
                        )}
                      </div>
                      {/* `t.preuve` est un CHEMIN vers la route de contenu, pas
                          l'image. Le trombone ouvre la pièce directement, sans
                          passer par la fiche. */}
                      <div className="text-center">
                        {t.preuve ? (
                          <button
                            type="button"
                            className={a.preuveBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setApercu(t);
                            }}
                            title="Voir le justificatif"
                            aria-label={`Voir le justificatif de « ${t.titre} »`}
                          >
                            <Paperclip className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        ) : (
                          <span className={a.preuveVide} aria-hidden>—</span>
                        )}
                      </div>
                      <div className={`${a.tdAmount} ${a.tdMontant} ${t.type === "revenu" ? a.amountRevenue : a.amountExpense}`}>
                        {formatMontantTransaction(t.montant, t.type)}
                      </div>
                      <ChevronRight className={a.trChevron} aria-hidden />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* La fenêtre est rendue HORS de la carte, et c'est ce qui la rend
          visible. .card porte un `backdrop-filter`, or cette propriété fait de
          la carte le bloc conteneur de ses descendants en `position: fixed` :
          rendu à l'intérieur, le calque « plein écran » ne couvrait que la
          carte. Ne pas la replacer dans la <section>. */}
      {edition && (
        <Modal title={existante ? "Modifier la transaction" : "Nouvelle transaction"} size="xl" onClose={fermer}>
          <form className="flex flex-col gap-4" onSubmit={soumettre} noValidate>
            {/* Une écriture automatique porte le montant d'un document qui ne
                sera PAS recalculé : le comptable doit le lire avant de valider. */}
            {existante?.origine && (
              <p className={a.avertissement}>
                Écriture générée automatiquement par {LIBELLES_ORIGINE[existante.origine.type]}{" "}
                <strong>{existante.origine.numero}</strong>. La modifier ne change pas ce document : un écart
                apparaîtra entre les deux.
              </p>
            )}
            {existante?.estAnnulee && (
              <p className={a.avertissement}>
                Cette écriture est neutralisée : son écriture inverse suivra le nouveau montant et le nouveau sens.
              </p>
            )}
            <div className="form-grid">
              <Field label="Titre" required className="sm:col-span-2">
                <input
                  className="input-basic"
                  value={form.titre}
                  maxLength={LONGUEUR_MAX_TITRE}
                  onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
                  placeholder="Loyer hub Casablanca — septembre"
                />
              </Field>
              <Field
                label="Montant"
                required
                hint={verrouMontant ? "Une neutralisation suit l'écriture qu'elle neutralise." : undefined}
              >
                <Affix suffix="DH">
                  <input
                    className="input-bare"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0,00"
                    value={form.montant}
                    disabled={verrouMontant}
                    onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))}
                  />
                </Affix>
              </Field>
              <Field label="Type" required>
                <select
                  className="input-basic"
                  value={form.type}
                  disabled={verrouMontant}
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
                  value={form.categorieId}
                  onChange={(e) => setForm((f) => ({ ...f, categorieId: e.target.value }))}
                >
                  {!form.categorieId && <option value="">Choisir…</option>}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
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

              {existante?.preuve && !preuve.corps && (
                <PreuveExistante
                  retire={retirerPreuve}
                  onBasculer={() => setRetirerPreuve((v) => !v)}
                  onVoir={() => setApercu(existante)}
                />
              )}
              <ChampPreuve
                etat={preuve}
                libelle={existante?.preuve ? "Remplacer le justificatif" : "Justificatif"}
              />
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="form-actions">
              <button type="button" className="btn-outline" onClick={fermer} disabled={envoi}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={envoi}>
                {existante
                  ? envoi ? "Enregistrement…" : "Enregistrer les modifications"
                  : envoi ? "Création…" : "Créer la transaction"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Visionneuse du justificatif d'une écriture déjà enregistrée. Rendue
          hors de la carte pour la même raison que le formulaire ci-dessus. */}
      {apercu && (
        <ModalePreuve
          url={apercu.preuve}
          legende={`${apercu.titre} · ${formatDate(apercu.dateEffet)} · ${formatMontantTransaction(apercu.montant, apercu.type)}`}
          onClose={() => setApercu(null)}
        />
      )}

      {/* Masquée pendant la modification (une fenêtre à la fois) et
          rouverte ensuite, à jour : on revient à ce qu'on consultait. */}
      {detail && !edition && (
        <DetailTransaction
          transaction={detail}
          liee={detailLiee}
          corbeille={corbeille}
          peutModifier={peutModifier}
          peutSupprimer={peutSupprimer}
          actionEnCours={actionEnCours}
          onModifier={() => ouvrirModification(detail)}
          onAnnuler={() => annuler(detail)}
          onSupprimer={() => supprimer(detail)}
          onRestaurer={() => restaurer(detail)}
          onOuvrirLiee={() => detailLiee && setDetailId(detailLiee.id)}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}
