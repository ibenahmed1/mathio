'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Send } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { GROUPE_AUCUN, GROUPE_PLUSIEURS, regrouperParTransporteur } from '@/lib/bon-envoi-groupes';

// § /admin/bon-envoi/creer, mode « Remise à un transporteur ».
//
// Ce que cet écran fait exprès de NE PAS faire : filtrer les colis par la
// ville. Confier un colis à tel transporteur est une décision d'exploitation,
// et la carte « quelle région pour quel prestataire » n'est pas encore figée
// (§ SOUS_TRAITANCE.md). Un filtre géographique ne protégerait donc rien — il
// masquerait des colis sans le dire. Une ville que le transporteur ne tarife
// pas est signalée, jamais retirée.

interface Transporteur {
  id: string;
  nom: string;
  nbVillesTarifees: number;
  nbAgences: number;
}

interface HubSource {
  id: string;
  nom: string;
  estCentral: boolean;
  prestataireNom: string | null;
  nbColisEligibles: number;
}

interface ColisEligible {
  id: string;
  codeSuivi: string;
  ville: string;
  statut: string;
  clientNom: string;
  montantCod: number;
  marchandNom: string | null;
  hubActuelNom: string | null;
  tarifAchat: number | null;
  transporteursVille: { id: string; nom: string }[];
}

export function BonEnvoiTransporteur() {
  const router = useRouter();

  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [hubs, setHubs] = useState<HubSource[]>([]);
  const [chargementOptions, setChargementOptions] = useState(true);

  const [prestataireId, setPrestataireId] = useState('');
  const [hubActuelId, setHubActuelId] = useState('');
  const [tousStatuts, setTousStatuts] = useState(false);

  const [colis, setColis] = useState<ColisEligible[]>([]);
  const [chargementColis, setChargementColis] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Les effets ne font que la requête : les remises à zéro synchrones
  // (indicateurs de chargement, sélection) sont faites par les gestionnaires
  // d'événements, via changerPerimetre.
  useEffect(() => {
    let annule = false;
    apiGet<{ transporteurs: Transporteur[]; hubs: HubSource[] }>(
      `/api/bons-envoi/transporteurs?tousStatuts=${tousStatuts ? '1' : '0'}`
    )
      .then((res) => {
        if (annule) return;
        setTransporteurs(res.transporteurs);
        setHubs(res.hubs);
      })
      .catch((err) => !annule && setErreur(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => !annule && setChargementOptions(false));
    return () => {
      annule = true;
    };
  }, [tousStatuts]);

  useEffect(() => {
    if (!prestataireId) return;
    let annule = false;
    const params = new URLSearchParams({ prestataireId, tousStatuts: tousStatuts ? '1' : '0' });
    if (hubActuelId) params.set('hubActuelId', hubActuelId);

    apiGet<{ data: ColisEligible[] }>(`/api/bons-envoi/colis-eligibles?${params.toString()}`)
      .then((res) => !annule && setColis(res.data))
      .catch((err) => !annule && setErreur(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => !annule && setChargementColis(false));
    return () => {
      annule = true;
    };
  }, [prestataireId, hubActuelId, tousStatuts]);

  // La sélection est vidée à chaque changement de périmètre : garder des colis
  // cochés devenus invisibles ferait partir des colis que l'opérateur ne voit
  // plus à l'écran.
  function changerPerimetre(prochainPrestataireId: string) {
    setSelection(new Set());
    if (prochainPrestataireId) setChargementColis(true);
    else setColis([]);
  }

  const transporteur = useMemo(
    () => transporteurs.find((t) => t.id === prestataireId) ?? null,
    [transporteurs, prestataireId]
  );

  const nbSansTarif = useMemo(
    () => colis.filter((c) => selection.has(c.id) && c.tarifAchat === null).length,
    [colis, selection]
  );

  const coutTotalConnu = useMemo(
    () => colis.filter((c) => selection.has(c.id)).reduce((somme, c) => somme + (c.tarifAchat ?? 0), 0),
    [colis, selection]
  );

  const toutSelectionne = colis.length > 0 && selection.size === colis.length;

  // Les colis sont GROUPÉS par le transporteur qui dessert leur ville, celui en
  // cours de composition en tête. C'est un ordre d'affichage : rien n'est
  // masqué, et un colis d'un autre groupe reste sélectionnable — confier un
  // colis reste un arbitrage d'exploitation (cf. l'en-tête de ce fichier).
  const groupes = useMemo(
    () => regrouperParTransporteur(colis, prestataireId || null),
    [colis, prestataireId]
  );

  function basculerTout() {
    setSelection(toutSelectionne ? new Set() : new Set(colis.map((c) => c.id)));
  }

  function basculerGroupe(ids: string[]) {
    setSelection((prev) => {
      const suivant = new Set(prev);
      const complet = ids.every((id) => suivant.has(id));
      for (const id of ids) {
        if (complet) suivant.delete(id);
        else suivant.add(id);
      }
      return suivant;
    });
  }

  function basculer(id: string) {
    setSelection((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  async function creer() {
    if (!prestataireId || selection.size === 0) return;
    setCreation(true);
    setErreur(null);
    try {
      const bon = await apiPost<{ id: string }>('/api/bons-envoi', {
        prestataireId,
        colisIds: Array.from(selection),
        tousStatuts,
      });
      router.push(`/admin/bon-envoi/${bon.id}`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
      setCreation(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

      <div className="card-tint-strong grid gap-4 p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold uppercase tracking-wide opacity-70">1. Transporteur</label>
          <select
            className="input-basic"
            value={prestataireId}
            onChange={(e) => {
              setPrestataireId(e.target.value);
              changerPerimetre(e.target.value);
            }}
            disabled={chargementOptions}
          >
            <option value="">{chargementOptions ? 'Chargement…' : 'Sélectionner un transporteur'}</option>
            {transporteurs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom} ({t.nbVillesTarifees} villes tarifées)
              </option>
            ))}
          </select>
          {transporteur && transporteur.nbVillesTarifees === 0 && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Aucune grille tarifaire chargée pour {transporteur.nom} : tous les colis partiront à coût d&apos;achat
              inconnu.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold uppercase tracking-wide opacity-70">2. Où sont les colis</label>
          <select
            className="input-basic"
            value={hubActuelId}
            onChange={(e) => {
              setHubActuelId(e.target.value);
              changerPerimetre(prestataireId);
            }}
            disabled={chargementOptions}
          >
            <option value="">Tous les hubs</option>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.nom} ({h.nbColisEligibles})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs font-medium opacity-80">
            <input
              type="checkbox"
              checked={tousStatuts}
              onChange={(e) => {
                setTousStatuts(e.target.checked);
                setChargementOptions(true);
                changerPerimetre(prestataireId);
              }}
              className="h-4 w-4"
            />
            Afficher tous les colis expédiables (hors livrés, retournés et annulés)
          </label>
        </div>
      </div>

      {prestataireId && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
              3. Colis à confier ({selection.size} sur {colis.length})
            </h2>
            {selection.size > 0 && (
              <p className="text-xs opacity-70">
                Coût d&apos;achat connu : <span className="font-semibold">{coutTotalConnu.toFixed(2)} DH</span>
                {nbSansTarif > 0 && ` — ${nbSansTarif} colis à coût inconnu`}
              </p>
            )}
          </div>

          {nbSansTarif > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {nbSansTarif} colis sélectionné{nbSansTarif > 1 ? 's' : ''} vise
                {nbSansTarif > 1 ? 'nt' : ''} une ville absente de la grille de {transporteur?.nom}. Le bon peut être
                créé — leur coût restera inconnu tant que le tarif n&apos;est pas saisi, et n&apos;entrera donc dans
                aucun calcul de marge.
              </span>
            </div>
          )}

          <div className="min-w-0 overflow-x-auto">
            {chargementColis ? (
              <p className="py-4 text-center opacity-60">Chargement des colis…</p>
            ) : (
              <table className="table-basic min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={toutSelectionne}
                        onChange={basculerTout}
                        disabled={colis.length === 0}
                        className="h-4 w-4"
                        aria-label="Tout sélectionner"
                      />
                    </th>
                    <th>Code</th>
                    <th>Marchand</th>
                    <th>Ville</th>
                    <th>Position</th>
                    <th>Statut</th>
                    <th>COD</th>
                    <th>Coût d&apos;achat</th>
                  </tr>
                </thead>
                <tbody>
                  {groupes.map((groupe) => {
                    const ids = groupe.colis.map((c) => c.id);
                    const groupeComplet = ids.every((id) => selection.has(id));
                    const sansReseau = groupe.cle === GROUPE_AUCUN;
                    const partagee = groupe.cle.startsWith(GROUPE_PLUSIEURS);
                    return (
                      <Fragment key={groupe.cle}>
                        <tr className="bg-black/[0.04] dark:bg-white/[0.06]">
                          <td>
                            <input
                              type="checkbox"
                              checked={groupeComplet}
                              onChange={() => basculerGroupe(ids)}
                              className="h-4 w-4"
                              aria-label={`Sélectionner les colis de ${groupe.libelle}`}
                            />
                          </td>
                          <td colSpan={7} className="text-sm font-semibold">
                            {sansReseau && <AlertTriangle className="mr-1.5 inline h-4 w-4 text-amber-600" />}
                            {groupe.libelle}
                            <span className="ml-2 font-normal opacity-60">
                              {groupe.colis.length} colis
                              {groupe.cle === prestataireId && ' — desservis par le transporteur choisi'}
                              {partagee && ' — plusieurs réseaux desservent ces villes'}
                            </span>
                          </td>
                        </tr>
                        {groupe.colis.map((c) => {
                          const inclus = selection.has(c.id);
                          return (
                      <tr key={c.id} className={inclus ? 'bg-brand/10' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={inclus}
                            onChange={() => basculer(c.id)}
                            className="h-4 w-4"
                            aria-label={`Sélectionner ${c.codeSuivi}`}
                          />
                        </td>
                        <td className="font-mono">{c.codeSuivi}</td>
                        <td>{c.marchandNom ?? '—'}</td>
                        <td>{c.ville}</td>
                        <td className="text-xs opacity-70">{c.hubActuelNom ?? 'Entrepôt central'}</td>
                        <td className="whitespace-nowrap text-xs opacity-70">
                          {LABELS_STATUT_COMMANDE[c.statut as keyof typeof LABELS_STATUT_COMMANDE] ?? c.statut}
                        </td>
                        <td className="whitespace-nowrap">{c.montantCod.toFixed(2)} DH</td>
                        <td className="whitespace-nowrap">
                          {c.tarifAchat === null ? (
                            <span className="badge bg-amber-500/20 text-amber-800 dark:text-amber-300">
                              Non tarifée
                            </span>
                          ) : (
                            `${c.tarifAchat.toFixed(2)} DH`
                          )}
                        </td>
                      </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {colis.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center opacity-60">
                        Aucun colis dans ce périmètre. Élargissez le hub, ou cochez « afficher tous les colis
                        expédiables ».
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={creer}
              disabled={selection.size === 0 || creation}
              className="btn-primary flex max-w-full items-center gap-2 whitespace-normal px-5 py-2.5"
            >
              <Send className="h-4 w-4 shrink-0" />
              {creation ? 'Création…' : `Confier ${selection.size} colis à ${transporteur?.nom ?? 'ce transporteur'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
