"use client";

import { useCallback, useRef, useState } from "react";
import { BookOpen, PackagePlus, Plus, Tags, Trash2 } from "lucide-react";
import { SidebarToggleButtons } from "@/components/admin/SidebarToggleButtons";
import CashflowReport from "./CashflowReport";
import InventoryOrders from "./InventoryOrders";
import TransactionsTable from "./TransactionsTable";
import { GestionCategories } from "./Categories";
import a from "./Accounting.module.css";

// En-tête et coordination de l'écran de comptabilité.
//
// Les actions de PAGE vivent ici, en haut, en toutes lettres et par ordre
// d'importance : saisir une transaction (le geste quotidien), saisir une
// commande, gérer les catégories, basculer vers la corbeille. Les actions sur
// UNE ligne vivent dans la barre de sélection du tableau (TransactionsTable),
// qui nomme la ligne visée.
//
// Rafraîchissements croisés :
//   - `refreshToken` : toute mutation du journal met à jour les totaux déjà
//     chargés par CashflowReport (composants frères, chacun son fetch) ;
//   - `jetonCategories` : une catégorie ajoutée ou renommée apparaît dans les
//     formulaires et les listes des deux cartes.
//
// `peutModifier` / `peutSupprimer` viennent de la session, côté serveur
// (app/admin/comptabilite/page.jsx). Ils ne font que masquer des boutons :
// l'API refuse d'elle-même sans `comptabilite:edit` / `comptabilite:delete`.
export default function ComptabiliteBoard({ peutModifier = false, peutSupprimer = false } = {}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const rafraichir = useCallback(() => setRefreshToken((v) => v + 1), []);
  const [jetonCategories, setJetonCategories] = useState(0);
  const [gestionCategories, setGestionCategories] = useState(false);
  // Une seule bascule pour les deux cartes : « la corbeille » est un lieu,
  // pas une option de chaque liste.
  const [corbeille, setCorbeille] = useState(false);
  const transactionsRef = useRef(null);
  const commandesRef = useRef(null);

  return (
    <>
      <header className={a.pageHead}>
        <div className={a.titleRow}>
          <SidebarToggleButtons className={a.sidebarToggle} />
          <h1 className="page-title">Comptabilité &amp; paie</h1>
        </div>

        <div className={a.pageActions} role="toolbar" aria-label="Actions de la comptabilité">
          {peutSupprimer && (
            <div className={a.vueBascule} role="group" aria-label="Vue">
              <button
                type="button"
                className={corbeille ? a.vueOption : a.vueOptionActive}
                aria-pressed={!corbeille}
                onClick={() => setCorbeille(false)}
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                Journal
              </button>
              <button
                type="button"
                className={corbeille ? a.vueOptionActive : a.vueOption}
                aria-pressed={corbeille}
                onClick={() => setCorbeille(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Corbeille
              </button>
            </div>
          )}
          {peutModifier && (
            <button type="button" className="btn-outline" onClick={() => setGestionCategories(true)}>
              <Tags className="h-4 w-4" aria-hidden />
              Catégories
            </button>
          )}
          {/* Pas de saisie depuis la corbeille : on y restaure, on n'y crée pas. */}
          {!corbeille && (
            <>
              <button type="button" className="btn-outline" onClick={() => commandesRef.current?.ouvrirCreation()}>
                <PackagePlus className="h-4 w-4" aria-hidden />
                Nouvelle commande
              </button>
              <button type="button" className="btn-primary" onClick={() => transactionsRef.current?.ouvrirCreation()}>
                <Plus className="h-4 w-4" aria-hidden />
                Nouvelle transaction
              </button>
            </>
          )}
        </div>
      </header>

      {corbeille && (
        <p className={a.bandeauCorbeille}>
          Vous consultez la corbeille : les éléments ci-dessous sont hors du journal et des totaux. Sélectionnez-en un
          pour le restaurer.
        </p>
      )}

      <div className={a.grid}>
        <div className={a.colLeft}>
          <CashflowReport refreshToken={refreshToken} />
          <InventoryOrders
            ref={commandesRef}
            corbeille={corbeille}
            jetonCategories={jetonCategories}
            peutModifier={peutModifier}
            peutSupprimer={peutSupprimer}
          />
        </div>
        <TransactionsTable
          ref={transactionsRef}
          corbeille={corbeille}
          onMutate={rafraichir}
          jetonCategories={jetonCategories}
          peutModifier={peutModifier}
          peutSupprimer={peutSupprimer}
        />
      </div>

      {gestionCategories && (
        <GestionCategories
          jeton={jetonCategories}
          onChange={() => setJetonCategories((v) => v + 1)}
          onClose={() => setGestionCategories(false)}
          peutSupprimer={peutSupprimer}
        />
      )}
    </>
  );
}
