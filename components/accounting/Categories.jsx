"use client";

import { useEffect, useState } from "react";
import { Check, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Modal } from "@/components/admin/Modal";
import { LABELS_PORTEE_CATEGORIE, LONGUEUR_MAX_NOM_CATEGORIE, PORTEES_CATEGORIE } from "@/lib/finance";
import a from "./Accounting.module.css";

// Catégories des deux cartes de /admin/comptabilite (§ CategorieComptable).
//
//   useCategoriesComptables(portee, jeton) — la liste, pour les <select> ;
//   <GestionCategories>                    — la fenêtre d'administration.
//
// `jeton` est le compteur de ComptabiliteBoard : une catégorie ajoutée ou
// renommée dans la fenêtre doit apparaître dans les formulaires déjà montés
// sans recharger la page.

export function useCategoriesComptables(portee, jeton = 0) {
  const [categories, setCategories] = useState([]);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let actif = true;
    apiGet(`/api/finance/categories?portee=${portee}`)
      .then((res) => {
        if (actif) {
          setCategories(res.data ?? []);
          setErreur(null);
        }
      })
      .catch((err) => {
        if (actif) setErreur(err instanceof Error ? err.message : "Erreur");
      });
    return () => {
      actif = false;
    };
  }, [portee, jeton]);

  return { categories, erreur };
}

function LigneCategorie({ categorie, peutSupprimer, onChange }) {
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState(categorie.nom);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  async function renommer(e) {
    e.preventDefault();
    if (!nom.trim() || nom.trim() === categorie.nom) {
      setEdition(false);
      setNom(categorie.nom);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await apiPatch(`/api/finance/categories/${categorie.id}`, { nom });
      setEdition(false);
      onChange();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimer() {
    if (!window.confirm(`Supprimer la catégorie « ${categorie.nom} » ?`)) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await apiDelete(`/api/finance/categories/${categorie.id}`);
      onChange();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur");
      setEnvoi(false);
    }
  }

  // Pourquoi le bouton est grisé, dit au survol plutôt que découvert par un
  // 409 : une catégorie protégée ou encore portée ne se supprime pas.
  const raisonBlocage = categorie.protegee
    ? "Reçoit les écritures automatiques : renommable, pas supprimable"
    : categorie.nbUtilisations > 0
      ? `Portée par ${categorie.nbUtilisations} pièce(s) : changez-leur de catégorie d'abord`
      : null;

  return (
    <li className={a.categorieLigne}>
      {edition ? (
        <form className="flex flex-1 items-center gap-2" onSubmit={renommer}>
          <input
            className="input-basic flex-1"
            value={nom}
            maxLength={LONGUEUR_MAX_NOM_CATEGORIE}
            onChange={(e) => setNom(e.target.value)}
            aria-label={`Nouveau nom de la catégorie ${categorie.nom}`}
            autoFocus
          />
          <button type="submit" className="btn-primary btn-sm" disabled={envoi} aria-label="Enregistrer le nom">
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setEdition(false);
              setNom(categorie.nom);
            }}
            aria-label="Annuler le renommage"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </form>
      ) : (
        <>
          <span className={a.categorieNom}>
            {categorie.nom}
            {categorie.protegee && <Lock className="h-3 w-3 opacity-50" aria-label="Catégorie protégée" />}
          </span>
          <span className={a.categorieCompte}>
            {categorie.nbUtilisations > 0 ? `${categorie.nbUtilisations} pièce(s)` : "inutilisée"}
          </span>
          <button
            type="button"
            className={a.rowMenu}
            onClick={() => setEdition(true)}
            title="Renommer"
            aria-label={`Renommer ${categorie.nom}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          {peutSupprimer && (
            <button
              type="button"
              className={`${a.rowMenu} ${a.rowMenuDanger}`}
              onClick={supprimer}
              disabled={envoi || !!raisonBlocage}
              title={raisonBlocage ?? "Supprimer"}
              aria-label={`Supprimer ${categorie.nom}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </>
      )}
      {erreur && <p className="form-error w-full">{erreur}</p>}
    </li>
  );
}

// Fenêtre d'administration des catégories, un onglet par carte. Réservée à
// `comptabilite:edit` (l'appelant ne l'ouvre pas sinon) ; la suppression
// demande en plus `comptabilite:delete`.
export function GestionCategories({ jeton, onChange, onClose, peutSupprimer }) {
  const [portee, setPortee] = useState(PORTEES_CATEGORIE[0]);
  const { categories, erreur } = useCategoriesComptables(portee, jeton);
  const [nom, setNom] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurAjout, setErreurAjout] = useState(null);

  async function ajouter(e) {
    e.preventDefault();
    if (!nom.trim()) return;
    setEnvoi(true);
    setErreurAjout(null);
    try {
      await apiPost("/api/finance/categories", { nom, portee });
      setNom("");
      onChange();
    } catch (err) {
      setErreurAjout(err instanceof Error ? err.message : "Erreur");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal title="Catégories comptables" size="xl" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className={a.onglets} role="tablist">
          {PORTEES_CATEGORIE.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === portee}
              className={p === portee ? a.ongletActif : a.onglet}
              onClick={() => setPortee(p)}
            >
              {LABELS_PORTEE_CATEGORIE[p]}
            </button>
          ))}
        </div>

        <form className="flex items-start gap-2" onSubmit={ajouter}>
          <input
            className="input-basic flex-1"
            value={nom}
            maxLength={LONGUEUR_MAX_NOM_CATEGORIE}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nouvelle catégorie…"
            aria-label="Nom de la nouvelle catégorie"
          />
          <button type="submit" className="btn-primary" disabled={envoi || !nom.trim()}>
            <Plus className="h-4 w-4" aria-hidden />
            Ajouter
          </button>
        </form>
        {erreurAjout && <p className="form-error">{erreurAjout}</p>}
        {erreur && <p className="form-error">{erreur}</p>}

        {categories.length === 0 ? (
          <div className="empty-state">Aucune catégorie pour les {LABELS_PORTEE_CATEGORIE[portee].toLowerCase()}.</div>
        ) : (
          <ul className={a.categorieListe}>
            {categories.map((c) => (
              <LigneCategorie key={c.id} categorie={c} peutSupprimer={peutSupprimer} onChange={onChange} />
            ))}
          </ul>
        )}

        <p className="form-hint">
          Un renommage vaut pour toutes les pièces déjà classées. Une catégorie ne se supprime que lorsqu&apos;aucune
          pièce ne la porte, corbeille comprise.
        </p>
      </div>
    </Modal>
  );
}
