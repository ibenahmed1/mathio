'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { Etiquette } from '@/lib/types';
import { COULEURS_ETIQUETTE, LABELS_COULEUR_ETIQUETTE, labelClassName } from '@/lib/statuts';

// Sélecteur d'étiquettes partagé par la fiche de création et la fiche de
// détail (§ /admin/tasks). Le catalogue vient de la base (/api/taches/
// etiquettes) : on peut en créer une sans quitter la fiche, ce qui évite
// l'aller-retour « je note le thème dans le titre faute d'étiquette qui
// existe ».
//
// La valeur manipulée est le `code` de l'étiquette, jamais son libellé : c'est
// ce que stocke Tache.etiquettes, et un renommage ne doit rien casser.
export function EtiquettesPicker({
  catalogue,
  selection,
  onChange,
  onCatalogueChange,
  peutCreer = true,
  disabled = false,
}: {
  catalogue: Etiquette[];
  selection: string[];
  onChange: (codes: string[]) => void;
  /** Remonte l'étiquette créée pour que le parent rafraîchisse son catalogue. */
  onCatalogueChange?: (creee: Etiquette) => void;
  peutCreer?: boolean;
  disabled?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState('');
  const [couleur, setCouleur] = useState<string>('docs');
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function basculer(code: string) {
    onChange(selection.includes(code) ? selection.filter((c) => c !== code) : [...selection, code]);
  }

  async function creer() {
    const libelle = nom.trim();
    if (!libelle) return;
    setCreation(true);
    setErreur(null);
    try {
      const creee = await apiPost<Etiquette>('/api/taches/etiquettes', { nom: libelle, couleur });
      onCatalogueChange?.(creee);
      // La nouvelle étiquette est posée d'emblée sur la tâche en cours : on
      // vient de la créer pour elle.
      onChange([...selection, creee.code]);
      setNom('');
      setOuvert(false);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setCreation(false);
    }
  }

  return (
    <>
      <div className="kdc-options">
        {catalogue.map((e) => {
          const on = selection.includes(e.code);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => basculer(e.code)}
              disabled={disabled}
              className="kdc-opt kdc-opt--plain"
              style={
                on
                  ? {
                      borderColor: `var(--label-${e.couleur}-fg)`,
                      background: `var(--label-${e.couleur}-bg)`,
                      color: `var(--label-${e.couleur}-fg)`,
                    }
                  : undefined
              }
            >
              {e.nom}
            </button>
          );
        })}
        {catalogue.length === 0 && <p className="kdc-side__empty">Aucune étiquette pour le moment</p>}
      </div>

      {peutCreer && !disabled && (
        <>
          <button type="button" className="kdc-side__add" onClick={() => setOuvert((v) => !v)}>
            {ouvert ? '− Fermer' : '+ Nouvelle étiquette'}
          </button>
          {ouvert && (
            <div className="kdc-newlabel">
              <input
                className="kdc-input kdc-input--full"
                style={{ marginTop: 0 }}
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    creer();
                  }
                }}
                placeholder="Nom de l'étiquette"
                autoFocus
              />
              {/* Le vrai chip sert d'échantillon : la charte étant monochrome,
                  des ronds de couleur seraient indistinguables. */}
              <div className="kdc-couleurs">
                {COULEURS_ETIQUETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCouleur(c)}
                    aria-pressed={couleur === c}
                    aria-label={`Couleur ${LABELS_COULEUR_ETIQUETTE[c]}`}
                    className={`kdc-label ${labelClassName(c)}`}
                  >
                    {nom.trim() || LABELS_COULEUR_ETIQUETTE[c]}
                  </button>
                ))}
              </div>
              {erreur && <p className="text-xs font-medium text-red-600">{erreur}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="kdc-check__add"
                  onClick={creer}
                  disabled={creation || !nom.trim()}
                >
                  {creation ? 'Création…' : 'Créer'}
                </button>
                <button
                  type="button"
                  className="kdc-check__x"
                  onClick={() => setOuvert(false)}
                  aria-label="Annuler la création"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
