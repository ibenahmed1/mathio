'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Check, Clock, Printer, Sparkles, Wallet } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { BonPaiementDetail } from '@/components/paiement/BonPaiementDetail';
import { ModaleReglement } from '@/components/paiement/ModaleReglement';
import type {
  HubDistribution,
  LignePaieMensuelle,
  ModeReglementLivreur,
  StatutPaieLivreur,
  TableauDeBordPaie,
} from '@/lib/types';

// § /admin/bon-paiement/livreur et /zone : les deux pages sont le MÊME écran,
// à une différence près — l'entrée « zone » impose d'abord de choisir un hub,
// qui filtre ensuite la liste des livreurs. Le document produit reste
// nominatif dans les deux cas (on paie une personne, pas une zone), d'où ce
// composant unique plutôt que deux pages divergentes à maintenir en parallèle.
//
// L'écran est un TABLEAU DE BORD MENSUEL et non une file d'attente : la
// question du comptable, le 5 du mois, n'est pas « qu'y a-t-il à faire ? »
// mais « qui reste-t-il à payer pour août ? ». D'où le mois comme axe
// principal, les livreurs sans bon affichés au même titre que les autres, et
// les trois KPIs qui se somment exactement à la masse du mois.

function montant(valeur: string | number) {
  return `${Number(valeur).toFixed(2)} DH`;
}

const LIBELLES_PAIE: Record<StatutPaieLivreur, string> = {
  paye: 'Payé',
  en_attente: 'En attente de paiement',
  non_genere: 'Non généré',
  sans_activite: 'Sans activité',
};

const CLASSES_PAIE: Record<StatutPaieLivreur, string> = {
  paye: 'bg-green-600 text-white',
  en_attente: 'bg-amber-400 text-amber-950',
  non_genere: 'badge-neutral',
  sans_activite: 'badge-neutral',
};

const MOIS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

// Mois écoulé : c'est celui qu'il y a à payer. Ouvrir sur le mois courant
// afficherait le 2 du mois un tableau presque vide.
function moisEcoule() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
}

function Kpi({
  label,
  valeur,
  detail,
  icone: Icone,
  teinte,
}: {
  label: string;
  valeur: string;
  detail: string;
  icone: typeof Wallet;
  teinte: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <span className={`rounded-lg p-2 ${teinte}`}>
        <Icone className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide opacity-60">{label}</p>
        <p className="font-mono text-xl font-black tabular-nums">{valeur}</p>
        <p className="text-xs opacity-60">{detail}</p>
      </div>
    </div>
  );
}

export function BonPaiementBoard({ parZone }: { parZone: boolean }) {
  const defaut = useMemo(moisEcoule, []);
  const [annee, setAnnee] = useState(defaut.annee);
  const [mois, setMois] = useState(defaut.mois);

  const [hubs, setHubs] = useState<HubDistribution[]>([]);
  const [hubId, setHubId] = useState<string>('');
  const [tableau, setTableau] = useState<TableauDeBordPaie | null>(null);
  const [filtre, setFiltre] = useState<StatutPaieLivreur | ''>('');
  const [bonOuvert, setBonOuvert] = useState<string | null>(null);
  const [aRegler, setARegler] = useState<LignePaieMensuelle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!parZone) return;
    apiGet<{ data: HubDistribution[] }>('/api/bons-distribution/zones')
      .then((res) => setHubs(res.data))
      .catch(() => {});
  }, [parZone]);

  const load = useCallback(() => {
    // En mode zone, tant qu'aucun hub n'est choisi on n'affiche rien : une
    // liste « tous hubs confondus » ferait doublon avec l'autre page.
    if (parZone && !hubId) {
      setTableau(null);
      return;
    }
    const params = new URLSearchParams({ annee: String(annee), mois: String(mois) });
    if (hubId) params.set('hubId', hubId);
    apiGet<TableauDeBordPaie>(`/api/bons-paiement/tableau-de-bord?${params}`)
      .then(setTableau)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [annee, mois, hubId, parZone]);

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, [load]);

  async function agir(action: () => Promise<unknown>) {
    setEnCours(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(false);
    }
  }

  // Génération de tout le mois. La route refuse une période encore ouverte
  // sans confirmation explicite : on la redemande ici plutôt que d'envoyer le
  // drapeau d'emblée, sinon l'avertissement ne servirait à rien.
  async function genererTout(autoriserPeriodeOuverte = false) {
    setEnCours(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiPost<{ generes: unknown[]; ignores: { nomComplet: string; raison: string }[] }>(
        '/api/bons-paiement/generer',
        { annee, mois, hubId: hubId || null, autoriserPeriodeOuverte }
      );
      setInfo(
        `${res.generes.length} bon(s) généré(s)${res.ignores.length > 0 ? ` — ${res.ignores.length} ignoré(s) : ${res.ignores.map((i) => `${i.nomComplet} (${i.raison})`).join(', ')}` : ''}`
      );
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      if (message.includes("n'est pas terminée") && window.confirm(`${message}\n\nGénérer quand même ?`)) {
        setEnCours(false);
        return genererTout(true);
      }
      setError(message);
    } finally {
      setEnCours(false);
    }
  }

  function genererUn(ligne: LignePaieMensuelle) {
    void agir(() => apiPost('/api/bons-paiement', { livreurId: ligne.livreurId, annee, mois }));
  }

  function payer(modeReglement: ModeReglementLivreur, referenceReglement: string) {
    const bonId = aRegler?.bon?.id;
    if (!bonId) return;
    void agir(async () => {
      await apiPost(`/api/bons-paiement/${bonId}/payer`, { modeReglement, referenceReglement });
      setARegler(null);
    });
  }

  if (bonOuvert) {
    return (
      <BonPaiementDetail
        bonId={bonOuvert}
        onRetour={() => {
          setBonOuvert(null);
          load();
        }}
      />
    );
  }

  const lignes = (tableau?.lignes ?? []).filter((l) => !filtre || l.statutPaie === filtre);
  const kpis = tableau?.kpis;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Paie livreurs — {parZone ? 'par zone' : 'par livreur'}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <select className="input-basic" value={mois} onChange={(e) => setMois(Number(e.target.value))}>
            {MOIS.map((nom, index) => (
              <option key={nom} value={index + 1}>
                {nom}
              </option>
            ))}
          </select>
          <select className="input-basic" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {[defaut.annee + 1, defaut.annee, defaut.annee - 1, defaut.annee - 2].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {parZone && (
            <select className="input-basic" value={hubId} onChange={(e) => setHubId(e.target.value)}>
              <option value="">Choisir un hub…</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.nom}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            disabled={enCours || !tableau || (kpis?.nbLivreursNonGeneres ?? 0) === 0}
            onClick={() => genererTout()}
            title="Crée un bon en brouillon pour chaque livreur qui n'en a pas encore sur ce mois"
          >
            <Sparkles className="h-4 w-4" />
            {enCours
              ? 'Génération…'
              : `Générer les bons du mois${kpis ? ` (${kpis.nbLivreursNonGeneres})` : ''}`}
          </button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {info && <p className="text-sm font-medium text-green-700 dark:text-green-400">{info}</p>}

      {parZone && !hubId && <p className="opacity-60">Choisissez un hub pour voir sa paie du mois.</p>}

      {kpis && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Masse du mois"
              valeur={montant(kpis.masseTotale)}
              detail={`${MOIS[mois - 1]} ${annee} — commissions + ajustements`}
              icone={CalendarClock}
              teinte="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            />
            <Kpi
              label="Payé"
              valeur={montant(kpis.totalPaye)}
              detail={`${kpis.nbLivreursPayes} livreur(s)`}
              icone={Check}
              teinte="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
            />
            <Kpi
              label="Reste à payer"
              valeur={montant(kpis.totalResteAPayer)}
              detail={`${kpis.nbLivreursEnAttente} bon(s) brouillon ou validé`}
              icone={Clock}
              teinte="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            />
            <Kpi
              label="Non généré"
              valeur={montant(kpis.totalNonGenere)}
              detail={`${kpis.nbLivreursNonGeneres} livreur(s) sans bon`}
              icone={Sparkles}
              teinte="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {([['', 'Tous'], ['paye', LIBELLES_PAIE.paye], ['en_attente', LIBELLES_PAIE.en_attente], ['non_genere', LIBELLES_PAIE.non_genere]] as const).map(
              ([valeur, label]) => (
                <button
                  key={valeur || 'tous'}
                  type="button"
                  onClick={() => setFiltre(valeur as StatutPaieLivreur | '')}
                  className={filtre === valeur ? 'btn-primary' : 'btn-outline'}
                >
                  {label}
                </button>
              )
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="table-basic min-w-[900px]">
              <thead>
                <tr>
                  <th>Livreur</th>
                  <th>Hub</th>
                  <th>État</th>
                  <th>Bon</th>
                  <th>Tournées</th>
                  <th>Livrés</th>
                  <th>Montant</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.livreurId}>
                    <td className="font-medium">
                      {l.nomComplet}
                      {l.telephone && <span className="block text-xs opacity-60">{l.telephone}</span>}
                    </td>
                    <td>{l.hubNom ?? '—'}</td>
                    <td>
                      <span className={`badge ${CLASSES_PAIE[l.statutPaie]}`}>{LIBELLES_PAIE[l.statutPaie]}</span>
                    </td>
                    <td className="font-mono text-xs">{l.bon?.numero ?? '—'}</td>
                    <td className="tabular-nums">{l.nbTournees}</td>
                    <td className="tabular-nums">{l.nbColisLivres}</td>
                    <td className="font-mono font-bold tabular-nums">
                      {montant(l.bon?.montantTotal ?? l.montantEnAttenteGeneration)}
                      {/* Reliquat : des tournées clôturées après la génération
                          du bon. Signalé plutôt qu'ajouté au total — cet argent
                          n'est PAS dans le bon existant et partira dans un
                          second bon. */}
                      {l.bon && l.montantEnAttenteGeneration > 0 && (
                        <span className="block text-xs font-normal text-amber-700 dark:text-amber-400">
                          + {montant(l.montantEnAttenteGeneration)} non généré
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        {!l.bon && (
                          <button
                            type="button"
                            className="btn-outline"
                            disabled={enCours}
                            onClick={() => genererUn(l)}
                          >
                            Générer
                          </button>
                        )}
                        {l.bon && (
                          <>
                            <button type="button" className="btn-outline" onClick={() => setBonOuvert(l.bon!.id)}>
                              Ouvrir
                            </button>
                            <Link
                              href={`/bons-paiement/${l.bon.id}`}
                              target="_blank"
                              className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                              title="Fiche de paie"
                            >
                              <Printer className="h-4 w-4" />
                            </Link>
                            {l.bon.statut === 'valide' && (
                              <button
                                type="button"
                                onClick={() => setARegler(l)}
                                disabled={enCours}
                                className="rounded p-1.5 text-green-700 hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950"
                                title="Marquer comme payé"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center opacity-60">
                      Aucun livreur pour ce filtre sur {MOIS[mois - 1].toLowerCase()} {annee}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aRegler?.bon && (
        <ModaleReglement
          numero={aRegler.bon.numero}
          beneficiaire={aRegler.nomComplet}
          montant={montant(aRegler.bon.montantTotal)}
          enCours={enCours}
          onClose={() => setARegler(null)}
          onConfirmer={payer}
        />
      )}
    </div>
  );
}
