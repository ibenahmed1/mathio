'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Medal, Trophy, X, XCircle } from 'lucide-react';
import {
  LIBELLES_VERDICT,
  analyserScenario,
  podium,
  type AnalyseScenario,
  type StatutVerdict,
} from '@/lib/simulateur-rentabilite';
import type { SimulationEnregistree } from '@/lib/simulations-rentabilite';
import { formateurMonnaie, nombre, pourcent, ratio } from './format';
import s from './Simulateur.module.css';

// § Simulateur de rentabilité — plusieurs produits côte à côte.
//
// Chaque colonne est RECALCULÉE depuis la saisie enregistrée (rien n'est lu
// de la base en dehors de la saisie) : la comparaison suit donc toujours le
// moteur courant.
//
// Le « meilleur » d'une ligne n'est marqué que si la comparaison a un sens :
// une ligne en montant n'est départagée que si tous les scénarios vendent
// dans la même devise, et les lignes d'hypothèses (prix, CPL…) ne le sont
// jamais — un prix plus haut n'est ni mieux ni moins bien.

export const MAX_COMPARES = 4;

type Format = 'monnaie' | 'pct' | 'ratio' | 'nombre' | 'points';

interface LigneComparaison {
  libelle: string;
  format: Format;
  sens?: 'max' | 'min';
  valeur: (a: AnalyseScenario, sim: SimulationEnregistree) => number | null;
}

interface Groupe {
  titre: string;
  lignes: LigneComparaison[];
}

const GROUPES: Groupe[] = [
  {
    titre: 'Hypothèses',
    lignes: [
      { libelle: 'Prix de vente', format: 'monnaie', valeur: (a) => a.parametres.prixVente },
      { libelle: 'Coût de revient unitaire', format: 'monnaie', valeur: (a) => a.parametres.coutUnitaire },
      { libelle: 'Budget publicitaire', format: 'monnaie', valeur: (a) => a.parametres.budgetPub },
      { libelle: 'Coût par prospect', format: 'monnaie', valeur: (a) => a.parametres.cpl || null },
      { libelle: 'Taux de confirmation', format: 'pct', valeur: (a) => a.parametres.tauxConfirmation },
      { libelle: 'Taux de livraison', format: 'pct', valeur: (a) => a.parametres.tauxLivraison },
    ],
  },
  {
    titre: 'Résultats',
    lignes: [
      {
        libelle: 'Commandes livrées',
        format: 'nombre',
        valeur: (a) => (a.resultats.complet ? a.resultats.livrees : null),
      },
      { libelle: 'CA encaissé', format: 'monnaie', valeur: (a) => (a.resultats.complet ? a.resultats.ca : null) },
      {
        libelle: 'Profit net',
        format: 'monnaie',
        sens: 'max',
        valeur: (a) => (a.resultats.complet ? a.resultats.profit : null),
      },
      { libelle: 'Marge nette', format: 'pct', sens: 'max', valeur: (a) => a.resultats.margeNette },
      {
        libelle: 'Profit par commande livrée',
        format: 'monnaie',
        sens: 'max',
        valeur: (a) => a.resultats.profitParLivree,
      },
      { libelle: 'CAC réel', format: 'monnaie', sens: 'min', valeur: (a) => a.resultats.cacReel },
      { libelle: 'ROAS', format: 'ratio', sens: 'max', valeur: (a) => a.resultats.roas },
    ],
  },
  {
    titre: 'Seuils de rentabilité',
    lignes: [
      { libelle: 'Break-even ROAS', format: 'ratio', sens: 'min', valeur: (a) => a.resultats.roasSeuil },
      { libelle: 'CPL maximal', format: 'monnaie', sens: 'max', valeur: (a) => a.resultats.cplMax },
      { libelle: 'Livraison minimale', format: 'pct', sens: 'min', valeur: (a) => a.resultats.tauxLivraisonSeuil },
      {
        libelle: 'Marge de sécurité livraison',
        format: 'points',
        sens: 'max',
        valeur: (a) => (a.resultats.complet ? a.margeSecuriteLivraison : null),
      },
    ],
  },
];

const ICONES: Record<StatutVerdict, typeof CheckCircle2> = {
  viable: CheckCircle2,
  risque_logistique: AlertTriangle,
  marge_incoherente: XCircle,
};

export default function ComparaisonSimulations({
  simulations,
  selection,
  onSelection,
  onOuvrir,
  chargement,
}: {
  simulations: SimulationEnregistree[];
  selection: string[];
  onSelection: (ids: string[]) => void;
  onOuvrir: (id: string) => void;
  chargement: boolean;
}) {
  const colonnes = useMemo(
    () =>
      selection
        .map((id) => simulations.find((sim) => sim.id === id))
        .filter((sim): sim is SimulationEnregistree => !!sim)
        .map((sim) => ({
          sim,
          analyse: analyserScenario(sim.entrees, sim.taux),
          monnaie: formateurMonnaie(sim.entrees.deviseVente),
        })),
    [selection, simulations],
  );
  const memeDevise = new Set(colonnes.map((c) => c.sim.entrees.deviseVente)).size <= 1;

  function basculer(id: string) {
    if (selection.includes(id)) onSelection(selection.filter((x) => x !== id));
    else if (selection.length < MAX_COMPARES) onSelection([...selection, id]);
  }

  function afficher(format: Format, valeur: number | null, monnaie: (n: number | null) => string): string {
    if (valeur === null || !Number.isFinite(valeur)) return '—';
    switch (format) {
      case 'monnaie':
        return monnaie(valeur);
      case 'pct':
        return pourcent(valeur);
      case 'ratio':
        return ratio(valeur);
      case 'points':
        return `${valeur >= 0 ? '+' : ''}${nombre(valeur * 100, 1)} pts`;
      default:
        return nombre(valeur);
    }
  }

  if (chargement) {
    return (
      <section className={s.card}>
        <p className={s.hint}>Chargement des simulations…</p>
      </section>
    );
  }

  if (simulations.length === 0) {
    return (
      <section className={s.card}>
        <h2 className={s.cardTitle}>Aucune simulation enregistrée</h2>
        <p className={s.hint} style={{ marginTop: 6 }}>
          Dans l’onglet « Simulateur », donnez un nom au produit puis cliquez sur « Enregistrer ». Chaque produit
          enregistré pourra ensuite être comparé ici, jusqu’à {MAX_COMPARES} à la fois.
        </p>
      </section>
    );
  }

  return (
    <div className={s.col}>
      <section className={s.card}>
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Produits à comparer</h2>
          <span className={s.hint}>
            {selection.length} / {MAX_COMPARES} sélectionnés
          </span>
        </div>
        <div className={s.cmpPicker}>
          {simulations.map((sim) => {
            const coche = selection.includes(sim.id);
            const plein = !coche && selection.length >= MAX_COMPARES;
            return (
              <label key={sim.id} className={`${s.cmpChip} ${coche ? s.cmpChipOn : ''} ${plein ? s.cmpChipOff : ''}`}>
                <input type="checkbox" checked={coche} disabled={plein} onChange={() => basculer(sim.id)} />
                <span>{sim.nom}</span>
              </label>
            );
          })}
        </div>
      </section>

      {colonnes.length < 2 ? (
        <section className={s.card}>
          <div className={s.chartVide}>
            <p>Cochez au moins deux produits pour les voir côte à côte.</p>
          </div>
        </section>
      ) : (
        <section className={s.card}>
          {!memeDevise && (
            <p className={s.hint} style={{ marginBottom: 10 }}>
              Ces produits ne sont pas vendus dans la même devise : les montants ne sont pas départagés, seuls les
              pourcentages et les ratios le sont.
            </p>
          )}
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.cmpTable}`}>
              <thead>
                <tr>
                  <th />
                  {colonnes.map(({ sim }) => (
                    <th key={sim.id} className={s.cmpHead}>
                      <span className={s.cmpNom} title={sim.nom}>
                        {sim.nom}
                      </span>
                      <span className={s.cmpActions}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => onOuvrir(sim.id)}
                          title="Ouvrir dans le simulateur"
                        >
                          <FolderOpen size={15} />
                          <span className={s.srOnly}>Ouvrir {sim.nom}</span>
                        </button>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => basculer(sim.id)}
                          title="Retirer de la comparaison"
                        >
                          <X size={15} />
                          <span className={s.srOnly}>Retirer {sim.nom}</span>
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Verdict</td>
                  {colonnes.map(({ sim, analyse }) => {
                    const v = analyse.verdict;
                    if (!v)
                      return (
                        <td key={sim.id} className={s.vide}>
                          Incomplète
                        </td>
                      );
                    const Icone = ICONES[v.statut];
                    return (
                      <td key={sim.id}>
                        <span className={`${s.cmpVerdict} ${s[v.statut]}`}>
                          <Icone size={14} /> {LIBELLES_VERDICT[v.statut]}
                        </span>
                      </td>
                    );
                  })}
                </tr>
                {GROUPES.map((g) => (
                  <GroupeLignes
                    key={g.titre}
                    groupe={g}
                    colonnes={colonnes}
                    memeDevise={memeDevise}
                    afficher={afficher}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className={s.hint} style={{ marginTop: 10 }}>
            <Trophy size={12} style={{ verticalAlign: '-1px' }} /> meilleure valeur d’une ligne,{' '}
            <Medal size={12} style={{ verticalAlign: '-1px' }} /> deuxième (à partir de trois produits). Le profit net
            et le CA dépendent du budget investi : pour comparer des produits testés avec des budgets différents,
            fiez-vous à la marge, au profit par commande livrée et aux seuils.
          </p>
        </section>
      )}
    </div>
  );
}

function GroupeLignes({
  groupe,
  colonnes,
  memeDevise,
  afficher,
}: {
  groupe: Groupe;
  colonnes: { sim: SimulationEnregistree; analyse: AnalyseScenario; monnaie: (n: number | null) => string }[];
  memeDevise: boolean;
  afficher: (format: Format, valeur: number | null, monnaie: (n: number | null) => string) => string;
}) {
  return (
    <>
      <tr className={s.cmpGroupe}>
        <td colSpan={colonnes.length + 1}>{groupe.titre}</td>
      </tr>
      {groupe.lignes.map((l) => {
        const valeurs = colonnes.map((c) => l.valeur(c.analyse, c.sim));
        const departager = l.sens && (l.format !== 'monnaie' || memeDevise);
        const rangs = departager ? podium(valeurs, l.sens!) : new Map<number, 1 | 2>();
        return (
          <tr key={l.libelle}>
            <td>{l.libelle}</td>
            {colonnes.map((c, i) => {
              const rang = rangs.get(i);
              return (
                <td key={c.sim.id} className={rang === 1 ? s.cmpBest : rang === 2 ? s.cmpSecond : undefined}>
                  {rang === 1 && (
                    <>
                      <Trophy size={12} aria-hidden="true" /> <span className={s.srOnly}>Meilleur : </span>
                    </>
                  )}
                  {rang === 2 && (
                    <>
                      <Medal size={12} aria-hidden="true" /> <span className={s.srOnly}>Deuxième : </span>
                    </>
                  )}
                  {afficher(l.format, valeurs[i], c.monnaie)}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
