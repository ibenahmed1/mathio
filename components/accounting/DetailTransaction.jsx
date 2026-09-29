"use client";

import { Download, ExternalLink, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Modal } from "@/components/admin/Modal";
import { ListeHistorique } from "./Historique";
import { LABELS_TYPE_TRANSACTION, formatMontantTransaction } from "@/lib/finance";
import a from "./Accounting.module.css";

// Fiche d'une écriture du journal, ouverte d'un clic sur sa ligne.
//
// D'abord une CONSULTATION : tout ce que la ligne du tableau résume ou tait
// (description complète, origine automatique, lien d'annulation, justificatif,
// historique). Les actions sont posées en tête de fiche, en toutes lettres —
// on agit après avoir lu ce sur quoi on agit.

const LIBELLES_ORIGINE = { tournee: "la tournée", facture: "la facture", paie: "le bon de paie" };

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateHeure(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Info({ libelle, children, large = false }) {
  return (
    <div className={large ? `${a.detailInfo} ${a.detailInfoLarge}` : a.detailInfo}>
      <dt className={a.metaKey}>{libelle}</dt>
      <dd className={a.detailValeur}>{children}</dd>
    </div>
  );
}

export function DetailTransaction({
  transaction: t,
  // Écriture liée par l'annulation (l'origine d'une compensation, ou la
  // compensation d'une écriture annulée), si elle est dans le journal chargé.
  liee,
  corbeille,
  peutModifier,
  peutSupprimer,
  actionEnCours,
  onModifier,
  onAnnuler,
  onSupprimer,
  onRestaurer,
  onOuvrirLiee,
  onClose,
}) {
  const raisonAnnulation = t.estAnnulee
    ? "Déjà neutralisée"
    : t.transactionOrigineId
      ? "Une neutralisation ne se neutralise pas : supprimez-la pour la défaire"
      : null;

  const etat = corbeille
    ? `Supprimée le ${formatDate(t.supprimeLe)}${t.supprimePar ? ` par ${t.supprimePar.nomComplet}` : ""}`
    : t.estAnnulee
      ? "Neutralisée"
      : t.transactionOrigineId
        ? "Neutralisation (écriture inverse d'une autre)"
        : "Active";

  return (
    <Modal title={t.titre} size="xl" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {/* ---------- Actions ---------- */}
        {(corbeille ? peutSupprimer : true) && (
          <div className={a.detailActions}>
            {corbeille ? (
              <button type="button" className="btn-primary btn-sm" onClick={onRestaurer} disabled={actionEnCours}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Restaurer dans le journal
              </button>
            ) : (
              <>
                {peutModifier && (
                  <button type="button" className="btn-primary btn-sm" onClick={onModifier} disabled={actionEnCours}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Modifier
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={onAnnuler}
                  disabled={actionEnCours || !!raisonAnnulation}
                  title={raisonAnnulation ?? "Ajoute une écriture inverse, de même montant, qui remet le solde à zéro"}
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                  Neutraliser
                </button>
                {peutSupprimer && (
                  <button type="button" className="btn-danger btn-sm" onClick={onSupprimer} disabled={actionEnCours}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Supprimer
                  </button>
                )}
              </>
            )}
            {raisonAnnulation && !corbeille && <span className="form-hint">{raisonAnnulation}</span>}
          </div>
        )}

        {/* ---------- Montant ---------- */}
        <div className={a.detailMontantBloc}>
          <span className={`${a.detailMontant} ${t.type === "revenu" ? a.amountRevenue : a.amountExpense}`}>
            {formatMontantTransaction(t.montant, t.type)}
          </span>
          <span className={t.type === "revenu" ? a.chipRevenue : a.chipExpense}>{LABELS_TYPE_TRANSACTION[t.type]}</span>
          <span className={a.chipAnnulee}>{etat}</span>
        </div>

        {t.origine && (
          <p className={a.avertissement}>
            Écriture générée automatiquement par {LIBELLES_ORIGINE[t.origine.type]}{" "}
            <strong>{t.origine.numero}</strong>.
          </p>
        )}

        {/* ---------- Informations ---------- */}
        <dl className={a.detailGrille}>
          <Info libelle="Catégorie">{t.categorie?.nom ?? "—"}</Info>
          <Info libelle="Date d'effet">{formatDate(t.dateEffet)}</Info>
          <Info libelle="Saisie par">{t.auteur?.nomComplet ?? "—"}</Info>
          <Info libelle="Saisie le">{formatDateHeure(t.dateCreation)}</Info>
          <Info libelle="Description" large>
            {t.description ? <span className="whitespace-pre-line">{t.description}</span> : "—"}
          </Info>
          {(t.estAnnulee || t.transactionOrigineId) && (
            <Info libelle={t.transactionOrigineId ? "Neutralise l'écriture" : "Neutralisée par"} large>
              {liee ? (
                <button type="button" className={a.lienDetail} onClick={onOuvrirLiee}>
                  {liee.titre} · {formatMontantTransaction(liee.montant, liee.type)}
                </button>
              ) : (
                "Écriture absente de cette vue (supprimée ou filtrée)"
              )}
            </Info>
          )}
        </dl>

        {/* ---------- Justificatif ---------- */}
        <section className="flex flex-col gap-2">
          <h3 className={a.detailSection}>Justificatif</h3>
          {t.preuve ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              {/* La route de contenu sert l'image à la demande : elle n'est
                  chargée qu'à l'ouverture de la fiche, jamais avec le journal. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.preuve}
                alt={`Justificatif — ${t.titre}`}
                className="max-h-64 w-full rounded-xl border border-black/10 bg-black/[0.03] object-contain sm:max-w-xs dark:border-white/10 dark:bg-white/[0.04]"
              />
              <div className="flex flex-wrap gap-2">
                <a href={t.preuve} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Ouvrir en plein écran
                </a>
                <a href={t.preuve} download className="btn-outline btn-sm">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Télécharger
                </a>
              </div>
            </div>
          ) : (
            <p className="form-hint">Aucun justificatif joint.</p>
          )}
        </section>

        {/* ---------- Historique ---------- */}
        <section className="flex flex-col gap-2">
          <h3 className={a.detailSection}>Historique des modifications</h3>
          <ListeHistorique cible="transaction" id={t.id} />
        </section>
      </div>
    </Modal>
  );
}
