"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { LABELS_ACTION_HISTORIQUE, LABELS_CHAMP_HISTORIQUE, LABELS_TYPE_TRANSACTION } from "@/lib/finance";
import { LABELS_STATUT_COMMANDE_STOCK_HUB } from "@/lib/commandes-stock-hub";
import a from "./Accounting.module.css";

// Historique des manipulations d'une pièce comptable (§ HistoriqueComptable) :
// qui a modifié, supprimé ou restauré quoi, et quand. Lisible par quiconque
// lit le journal — c'est ce qui rend une modification contrôlable.

function formatDateHeure(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Les instantanés stockent des valeurs brutes (ISO, codes d'enum, nombres) :
// on les rend lisibles ici, champ par champ.
function formatValeur(champ, valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  if (champ === "montant") return `${Number(valeur).toFixed(2)} DH`;
  if (champ === "dateEffet" || champ === "dateCommande") {
    return new Date(valeur).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  }
  if (champ === "type") return LABELS_TYPE_TRANSACTION[valeur] ?? valeur;
  if (champ === "statut") return LABELS_STATUT_COMMANDE_STOCK_HUB[valeur] ?? valeur;
  return String(valeur);
}

function Changements({ avant, apres }) {
  const champs = [...new Set([...Object.keys(avant ?? {}), ...Object.keys(apres ?? {})])];
  if (champs.length === 0) return null;
  return (
    <dl className={a.histoChamps}>
      {champs.map((champ) => (
        <div key={champ} className={a.histoChamp}>
          <dt className={a.metaKey}>{LABELS_CHAMP_HISTORIQUE[champ] ?? champ}</dt>
          <dd className={a.metaVal}>
            {avant && apres ? (
              <>
                <span className={a.histoAvant}>{formatValeur(champ, avant[champ])}</span>
                {" → "}
                {formatValeur(champ, apres[champ])}
              </>
            ) : (
              formatValeur(champ, (avant ?? apres)[champ])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// La liste seule, sans fenêtre : affichée telle quelle dans la fiche d'une
// transaction, ou enveloppée par <ModaleHistorique> pour une commande.
export function ListeHistorique({ cible, id }) {
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let actif = true;
    apiGet(`/api/finance/historique?cible=${cible}&id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (actif) setLignes(res.data ?? []);
      })
      .catch((err) => {
        if (actif) setErreur(err instanceof Error ? err.message : "Erreur");
      });
    return () => {
      actif = false;
    };
  }, [cible, id]);

  if (erreur) return <p className="form-error">{erreur}</p>;
  if (lignes === null) return <p className="form-hint">Chargement…</p>;
  if (lignes.length === 0) {
    return (
      <p className="form-hint">
        Aucune modification depuis la saisie. Les pièces créées avant le 21/09/2026 n&apos;ont d&apos;historique
        qu&apos;à partir de cette date.
      </p>
    );
  }
  return (
    <ol className={a.histoListe}>
      {lignes.map((l) => (
        <li key={l.id} className={a.histoLigne}>
          <div className={a.histoTete}>
            <span className={a.chipAnnulee}>{LABELS_ACTION_HISTORIQUE[l.action]}</span>
            <span className={a.td}>
              {formatDateHeure(l.dateAction)} · {l.auteur}
            </span>
          </div>
          {/* Une suppression montre ce qui a été retiré, une restauration
              ce qui revient : un seul côté, pas de flèche. */}
          <Changements avant={l.avant} apres={l.apres} />
        </li>
      ))}
    </ol>
  );
}

export function ModaleHistorique({ cible, id, titre, onClose }) {
  return (
    <Modal title={`Historique — ${titre}`} size="xl" onClose={onClose}>
      <ListeHistorique cible={cible} id={id} />
    </Modal>
  );
}
