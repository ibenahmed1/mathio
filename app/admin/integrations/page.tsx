'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  ShieldOff,
  Store,
  Timer,
  Trash2,
  Truck,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import type {
  CleApi,
  EnvironnementApi,
  PlateformeDetail,
  PlateformeResume,
} from '@/lib/types';

// Intégrations partenaires (§ lib/plateformes.ts).
//
// L'écran existe pour trois questions qu'on se pose toujours dans cet ordre
// quand une intégration se plaint : quelles clés sont valides, quels marchands
// sont réellement liés, et qu'est-ce qui est arrivé sur le fil ces dernières
// minutes. D'où les trois blocs du panneau de détail, et pas un de plus.

// Catalogue recopié depuis lib/plateforme-cles.ts plutôt qu'importé : ce
// module lit `crypto`, que le bundle client ne doit pas embarquer. La
// divergence est bornée par le test « chaque scope du catalogue porte un
// libellé » côté serveur, et par le fait qu'un scope inconnu est de toute
// façon écarté à l'émission (assainirScopes).
const SCOPES: {
  cle: string;
  libelle: string;
  avertissement?: string;
  transporteur?: boolean;
  interditEnTest?: boolean;
}[] = [
  {
    cle: 'marchands:creation',
    libelle: 'Créer un compte marchand (en attente de validation)',
    avertissement: 'Le compte reste à approuver depuis /admin/marchands, comme une auto-inscription.',
  },
  {
    cle: 'marchands:creation_validee',
    libelle: 'Créer un compte marchand déjà validé',
    avertissement:
      'Court-circuite l’approbation par un admin (RF-22). Indisponible sur une clé de test.',
    interditEnTest: true,
  },
  { cle: 'colis:creation', libelle: 'Déposer des colis' },
  {
    cle: 'livraisons:statut',
    libelle: 'Poser un statut sur un colis confié',
    avertissement:
      'Mute des colis RÉELS : « livré » ferme le colis et le rend éligible à la facturation. Indisponible sur une clé de test — il n’y a pas de bac à sable pour ce flux.',
    transporteur: true,
    interditEnTest: true,
  },
];

function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function horodatageCourt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// L'état d'une clé se lit d'un coup d'œil ou ne se lit pas : révoquée et
// expirée mènent au même refus mais ne se corrigent pas pareil (réémettre vs
// prolonger), donc elles ne partagent pas de badge.
function badgeCle(cle: CleApi): { classe: string; texte: string } {
  if (cle.revoqueeLe) return { classe: 'badge badge-danger', texte: 'Révoquée' };
  if (cle.expireLe && new Date(cle.expireLe) <= new Date()) {
    return { classe: 'badge badge-danger', texte: 'Expirée' };
  }
  if (cle.expireLe) return { classe: 'badge badge-warn', texte: `Expire le ${dateCourte(cle.expireLe)}` };
  return { classe: 'badge badge-ok', texte: 'Active' };
}

export default function IntegrationsPage() {
  const [plateformes, setPlateformes] = useState<PlateformeResume[]>([]);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlateformeDetail | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [modale, setModale] = useState<'plateforme' | 'cle' | null>(null);
  // Valeur complète d'une clé fraîchement émise. Elle ne vit que dans cet état
  // React : elle n'est nulle part en base, et la page ne saura pas la
  // réafficher après un rechargement. C'est le sens même de la manœuvre.
  const [cleEmise, setCleEmise] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const liste = await apiGet<PlateformeResume[]>('/api/plateformes');
      setPlateformes(liste);
      setSelectionId((courant) => courant ?? liste[0]?.id ?? null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerDetail = useCallback(async (id: string) => {
    try {
      setDetail(await apiGet<PlateformeDetail>(`/api/plateformes/${id}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    }
  }, []);

  // Chargement différé d'un tour de boucle (`Promise.resolve().then`), comme
  // les autres écrans du back-office : appeler `charger()` dans le corps même
  // de l'effet y déclenche un setState synchrone, donc un rendu en cascade
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    Promise.resolve().then(() => charger());
  }, [charger]);

  useEffect(() => {
    Promise.resolve().then(() => {
      if (selectionId) return chargerDetail(selectionId);
      setDetail(null);
    });
  }, [selectionId, chargerDetail]);

  async function rafraichir() {
    await charger();
    if (selectionId) await chargerDetail(selectionId);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Intégrations partenaires</h1>
          <p className="page-subtitle">
            Les plateformes qui nous envoient leurs marchands et leurs colis, et les clés d’API qui
            les authentifient.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn-outline btn-sm" onClick={() => void rafraichir()}>
            <RefreshCw size={15} /> Rafraîchir
          </button>
          <button className="btn-primary btn-sm" onClick={() => setModale('plateforme')}>
            <Plus size={15} /> Nouvelle plateforme
          </button>
        </div>
      </div>

      {erreur && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle size={16} /> {erreur}
        </div>
      )}

      {chargement ? (
        <div className="empty-state">Chargement…</div>
      ) : plateformes.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <Plug size={28} className="opacity-40" />
            <p className="font-semibold">Aucune plateforme partenaire</p>
            <p>
              Une plateforme est un canal de vente qui nous envoie ses marchands et ses colis.
              L’API ne répond qu’à des clés émises depuis cet écran.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
          <ListePlateformes
            plateformes={plateformes}
            selectionId={selectionId}
            onSelect={setSelectionId}
          />

          {detail && (
            <PanneauDetail
              detail={detail}
              onNouvelleCle={() => setModale('cle')}
              onChange={() => void rafraichir()}
            />
          )}
        </div>
      )}

      {modale === 'plateforme' && (
        <ModalePlateforme
          onClose={() => setModale(null)}
          onCreee={(creee) => {
            setModale(null);
            setSelectionId(creee.id);
            void charger();
          }}
        />
      )}

      {modale === 'cle' && detail && (
        <ModaleCle
          plateforme={detail}
          onClose={() => setModale(null)}
          onCreee={(complete) => {
            setModale(null);
            setCleEmise(complete);
            void rafraichir();
          }}
        />
      )}

      {cleEmise && <ModaleCleEmise cle={cleEmise} onClose={() => setCleEmise(null)} />}
    </div>
  );
}

function ListePlateformes({
  plateformes,
  selectionId,
  onSelect,
}: {
  plateformes: PlateformeResume[];
  selectionId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {plateformes.map((p) => {
        const actif = p.id === selectionId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              actif
                ? 'border-brand bg-brand/10'
                : 'border-black/[0.07] bg-white hover:bg-brand/[0.06] dark:border-white/10 dark:bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{p.nom}</span>
              <span className={p.actif ? 'badge badge-ok' : 'badge badge-danger'}>
                {p.actif ? 'Active' : 'Suspendue'}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-black/45 dark:text-white/45">{p.code}</div>
            <div className="mt-2 flex gap-3 text-[11px] font-semibold text-black/50 dark:text-white/50">
              <span className="inline-flex items-center gap-1">
                <KeyRound size={12} /> {p.nbClesActives} clé{p.nbClesActives > 1 ? 's' : ''}
              </span>
              {/* La nature du compte se lit d'un coup d'œil : un transporteur
                  n'a pas de marchands synchronisés, et afficher « 0 marchand »
                  sur sa carte laisserait croire à une synchronisation en
                  panne. */}
              {p.prestataire ? (
                <span className="inline-flex items-center gap-1">
                  <Truck size={12} /> {p.prestataire.nom}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Store size={12} /> {p.nbMarchands} marchand{p.nbMarchands > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PanneauDetail({
  detail,
  onNouvelleCle,
  onChange,
}: {
  detail: PlateformeDetail;
  onNouvelleCle: () => void;
  onChange: () => void;
}) {
  const [enCours, setEnCours] = useState<string | null>(null);

  async function agirSurCle(cleId: string, action: 'revoquer' | 'expirer') {
    const confirmation =
      action === 'revoquer'
        ? 'Révoquer cette clé ? Le refus est immédiat et définitif : le partenaire sera coupé sans délai.'
        : 'Programmer l’expiration dans 7 jours ? La clé continue de fonctionner, avec un en-tête de dépréciation sur chaque appel.';
    if (!window.confirm(confirmation)) return;

    setEnCours(cleId);
    try {
      await apiPatch(`/api/plateformes/${detail.id}/cles/${cleId}`, { action });
      onChange();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action impossible');
    } finally {
      setEnCours(null);
    }
  }

  async function purger() {
    const v = detail.volumeTest;
    if (
      !window.confirm(
        `Supprimer définitivement ${v.marchands} marchand(s) et ${v.colis} colis créés en environnement test ?\n\n` +
          'Les données de production ne sont pas touchées, et les marchands qui existaient déjà chez nous ' +
          'avant d’être rattachés sont conservés. Cette suppression est irréversible.'
      )
    ) {
      return;
    }

    setEnCours('purge');
    try {
      await apiPost(`/api/plateformes/${detail.id}/purge-test`);
      onChange();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Purge impossible');
    } finally {
      setEnCours(null);
    }
  }

  async function basculerActif() {
    const suspendre = detail.actif;
    if (
      suspendre &&
      !window.confirm(
        'Suspendre cette plateforme ? Toutes ses clés cessent immédiatement de fonctionner, sans être révoquées — réactiver les remet en service.'
      )
    ) {
      return;
    }
    try {
      await apiPatch(`/api/plateformes/${detail.id}`, { actif: !detail.actif });
      onChange();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action impossible');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">{detail.nom}</h2>
          <p className="page-subtitle">
            Créée le {dateCourte(detail.dateCreation)} · code <code>{detail.code}</code>
          </p>
        </div>
        <div className="btn-row">
          <button className={detail.actif ? 'btn-danger btn-sm' : 'btn-outline btn-sm'} onClick={() => void basculerActif()}>
            <ShieldOff size={15} /> {detail.actif ? 'Suspendre' : 'Réactiver'}
          </button>
          <button className="btn-primary btn-sm" onClick={onNouvelleCle}>
            <Plus size={15} /> Émettre une clé
          </button>
        </div>
      </div>

      {/* ---------- Clés ---------- */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-black/50 dark:text-white/50">
          Clés d’API
        </h3>
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>Préfixe</th>
                  <th>Env.</th>
                  <th>Périmètre</th>
                  <th>État</th>
                  <th>Dernier appel</th>
                  <th className="cell-num">Appels</th>
                  <th className="cell-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {detail.cles.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        Aucune clé émise : l’API refuse tout appel de cette plateforme.
                      </div>
                    </td>
                  </tr>
                )}
                {detail.cles.map((cle) => {
                  const badge = badgeCle(cle);
                  return (
                    <tr key={cle.id}>
                      <td>
                        <span className="font-mono text-xs">mtk_{cle.environnement}_{cle.prefixe}…</span>
                        {cle.libelle && (
                          <div className="text-[11px] text-black/45 dark:text-white/45">{cle.libelle}</div>
                        )}
                      </td>
                      <td>
                        <span className={cle.environnement === 'live' ? 'badge badge-brand' : 'badge badge-neutral'}>
                          {cle.environnement}
                        </span>
                      </td>
                      <td className="text-xs">{cle.scopes.join(', ')}</td>
                      <td>
                        <span className={badge.classe}>{badge.texte}</span>
                      </td>
                      <td className="text-xs">
                        {cle.derniereUtilisationLe ? horodatageCourt(cle.derniereUtilisationLe) : 'Jamais'}
                      </td>
                      <td className="cell-num">{cle.nbAppels}</td>
                      <td className="cell-actions">
                        {cle.active && (
                          <div className="btn-row justify-end">
                            <button
                              className="btn-ghost btn-sm"
                              disabled={enCours === cle.id}
                              onClick={() => void agirSurCle(cle.id, 'expirer')}
                              title="Programmer l’expiration dans 7 jours (rotation sans coupure)"
                            >
                              <Timer size={14} /> Expirer
                            </button>
                            <button
                              className="btn-danger btn-sm"
                              disabled={enCours === cle.id}
                              onClick={() => void agirSurCle(cle.id, 'revoquer')}
                            >
                              <ShieldOff size={14} /> Révoquer
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Données de bac à sable ---------- */}
      {/* L'isolation retenue est LOGIQUE : les marchands et colis d'une clé
          `test` sont de vraies lignes dans les vraies tables. Ce bloc est la
          contrepartie de ce choix — il rend cette pollution visible et
          effaçable, au lieu de la laisser s'accumuler en silence. */}
      {(detail.volumeTest.marchands > 0 || detail.volumeTest.marchandsConserves > 0) && (
        <section>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-black/50 dark:text-white/50">
            Données de bac à sable
          </h3>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
            <div className="text-sm">
              <span className="font-bold">
                {detail.volumeTest.marchands} marchand{detail.volumeTest.marchands > 1 ? 's' : ''}
              </span>{' '}
              et{' '}
              <span className="font-bold">
                {detail.volumeTest.colis} colis
              </span>{' '}
              créés en environnement test, dans les tables réelles.
              {detail.volumeTest.marchandsConserves > 0 && (
                <span className="block text-[13px] text-black/55 dark:text-white/55">
                  {detail.volumeTest.marchandsConserves} marchand
                  {detail.volumeTest.marchandsConserves > 1 ? 's' : ''} et{' '}
                  {detail.volumeTest.colisConserves} colis ne seront <strong>pas</strong> supprimés :
                  ces marchands existaient déjà chez nous avant d’être rattachés. Leurs colis ne
                  portent aucune marque d’environnement, et les effacer risquerait d’emporter de
                  vraies commandes.
                </span>
              )}
            </div>
            <button
              className="btn-danger btn-sm ml-auto"
              disabled={enCours === 'purge'}
              onClick={() => void purger()}
            >
              <Trash2 size={15} /> Purger
            </button>
          </div>
        </section>
      )}

      {/* ---------- Marchands liés ---------- */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-black/50 dark:text-white/50">
          Marchands synchronisés ({detail.nbMarchands})
        </h3>
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>Boutique</th>
                  <th>Identifiant chez eux</th>
                  <th>Env.</th>
                  <th>Statut</th>
                  <th>Lié le</th>
                </tr>
              </thead>
              <tbody>
                {detail.marchands.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-state">Aucun marchand synchronisé pour l’instant.</div>
                    </td>
                  </tr>
                )}
                {detail.marchands.map((m) => (
                  <tr key={m.id}>
                    <td className="font-semibold">{m.nomBoutique}</td>
                    <td className="font-mono text-xs">{m.idExterne}</td>
                    <td>
                      <span className={m.environnement === 'live' ? 'badge badge-brand' : 'badge badge-neutral'}>
                        {m.environnement}
                      </span>
                    </td>
                    <td>
                      <span className={m.statut === 'actif' ? 'badge badge-ok' : 'badge badge-warn'}>
                        {m.statut}
                      </span>
                    </td>
                    <td className="text-xs">{dateCourte(m.dateCreation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Journal ---------- */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-black/50 dark:text-white/50">
          Derniers appels reçus
        </h3>
        <p className="mb-2 text-xs text-black/45 dark:text-white/45">
          Le corps des requêtes n’est pas conservé — il porterait des données de clients finaux. Le
          message d’erreur dit quel champ a été refusé, ce qui suffit à trancher entre un bug chez
          eux et un bug chez nous.
        </p>
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>Horodatage</th>
                  <th>Requête</th>
                  <th>Statut</th>
                  <th>Référence</th>
                  <th>Erreur</th>
                  <th className="cell-num">Durée</th>
                </tr>
              </thead>
              <tbody>
                {detail.appels.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">Aucun appel reçu pour l’instant.</div>
                    </td>
                  </tr>
                )}
                {detail.appels.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs">{horodatageCourt(a.horodatage)}</td>
                    <td className="font-mono text-xs">
                      {a.methode} {a.chemin}
                    </td>
                    <td>
                      <span className={a.statut < 400 ? 'badge badge-ok' : a.statut < 500 ? 'badge badge-warn' : 'badge badge-danger'}>
                        {a.statut}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{a.reference ?? '—'}</td>
                    <td className="text-xs text-black/60 dark:text-white/60">{a.erreur ?? '—'}</td>
                    <td className="cell-num text-xs">{a.dureeMs != null ? `${a.dureeMs} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function ModalePlateforme({
  onClose,
  onCreee,
}: {
  onClose: () => void;
  onCreee: (creee: PlateformeResume) => void;
}) {
  const [nom, setNom] = useState('');
  const [code, setCode] = useState('');
  const [prestataireId, setPrestataireId] = useState('');
  const [transporteurs, setTransporteurs] = useState<{ id: string; nom: string }[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Les transporteurs qui n'ont pas encore de compte machine. La liste peut
  // être vide — c'est le cas courant tant qu'aucun prestataire n'est branché —
  // et le champ disparaît alors, plutôt que d'offrir un choix sans option.
  useEffect(() => {
    apiGet<{ id: string; nom: string }[]>('/api/plateformes/transporteurs')
      .then(setTransporteurs)
      // Un référentiel indisponible ne doit pas empêcher de créer un canal de
      // vente, qui n'en a pas besoin : on dégrade en masquant le champ.
      .catch(() => setTransporteurs([]));
  }, []);

  // Le code est proposé d'après le nom, mais reste modifiable : il finit dans
  // des URL et des journaux, et le deviner mal une fois se paie longtemps.
  const codePropose = useMemo(
    () =>
      nom
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    [nom]
  );

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const creee = await apiPost<PlateformeResume>('/api/plateformes', {
        nom: nom.trim(),
        code: (code || codePropose).trim(),
        prestataireId: prestataireId || undefined,
      });
      onCreee(creee);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Création impossible');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal title="Nouvelle plateforme partenaire" onClose={onClose} size="sm">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <Field label="Nom" required hint="Affiché ici et comme auteur dans l’historique des colis ingérés.">
          <input className="input-basic" value={nom} onChange={(e) => setNom(e.target.value)} required autoFocus />
        </Field>
        <Field
          label="Code"
          hint="Identifiant stable, utilisé dans les URL et les journaux. Minuscules, chiffres et tirets."
        >
          <input
            className="input-basic"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={codePropose || 'shipeh'}
          />
        </Field>

        {transporteurs.length > 0 && (
          <Field
            label="Transporteur"
            hint="Laisser vide pour un canal de vente. Rattaché, ce compte ne dépose plus de colis : il déclare l’issue de ceux qu’on lui confie."
          >
            <select
              className="input-basic"
              value={prestataireId}
              onChange={(e) => setPrestataireId(e.target.value)}
            >
              <option value="">Aucun — canal de vente</option>
              {transporteurs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </select>
          </Field>
        )}

        <p className="text-xs text-black/50 dark:text-white/50">
          Un compte de service est créé en même temps. Il ne peut ouvrir de session sur aucun
          domaine : il n’existe que pour signer les écritures faites au nom de la plateforme.
        </p>

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi || !nom.trim()}>
            Créer
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ModaleCle({
  plateforme,
  onClose,
  onCreee,
}: {
  plateforme: PlateformeDetail;
  onClose: () => void;
  onCreee: (cleComplete: string) => void;
}) {
  // La nature du compte décide des deux valeurs par défaut. Un transporteur ne
  // dépose rien, il déclare — et son unique scope étant refusé en `test`, lui
  // proposer une clé de bac à sable serait lui proposer une clé sans aucun
  // pouvoir, donc un formulaire qui ne peut pas aboutir.
  const estTransporteur = plateforme.prestataire !== null;
  const [environnement, setEnvironnement] = useState<EnvironnementApi>(
    estTransporteur ? 'live' : 'test'
  );
  const [scopes, setScopes] = useState<string[]>(
    estTransporteur ? ['livraisons:statut'] : ['colis:creation']
  );
  const [libelle, setLibelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Les scopes de l'AUTRE nature ne sont pas grisés mais ABSENTS, et la
  // distinction est voulue : `marchands:creation_validee` redevient cochable
  // en passant la clé en `live`, alors qu'un scope de transporteur ne
  // deviendra jamais accordable sur un canal de vente. Griser ce qui ne peut
  // pas changer laisse chercher le geste qui l'ouvrirait.
  const scopesDuCompte = SCOPES.filter((s) => Boolean(s.transporteur) === estTransporteur);

  // Le refus définitif est côté serveur (SCOPES_INTERDITS_EN_TEST,
  // lib/plateforme-cles.ts) — ceci n'est que la version visible de la même
  // règle. Contrairement aux scopes de l'autre nature, ceux-ci sont GRISÉS et
  // non masqués : ils redeviennent cochables en passant la clé en `live`, et
  // c'est précisément le geste qu'on veut rendre visible.
  const scopeInterdit = (scope: string) =>
    environnement === 'test' && SCOPES.some((s) => s.cle === scope && s.interditEnTest);

  function basculer(scope: string) {
    setScopes((courants) =>
      courants.includes(scope) ? courants.filter((s) => s !== scope) : [...courants, scope]
    );
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await apiPost<{ cleComplete: string; cle: CleApi }>(
        `/api/plateformes/${plateforme.id}/cles`,
        {
          environnement,
          scopes: scopes.filter((s) => !scopeInterdit(s)),
          libelle: libelle.trim() || null,
        }
      );
      onCreee(reponse.cleComplete);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Émission impossible');
    } finally {
      setEnvoi(false);
    }
  }

  const retenus = scopes.filter((s) => !scopeInterdit(s));

  return (
    <Modal title={`Émettre une clé — ${plateforme.nom}`} onClose={onClose}>
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <Field label="Environnement" required>
          <div className="btn-row">
            {(['test', 'live'] as EnvironnementApi[]).map((env) => (
              <button
                key={env}
                type="button"
                className={environnement === env ? 'btn-dark btn-sm' : 'btn-outline btn-sm'}
                onClick={() => setEnvironnement(env)}
              >
                {env}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Périmètre" required hint="Une clé ne peut faire que ce qui est coché ici.">
          <div className="flex flex-col gap-2">
            {scopesDuCompte.map((s) => {
              const interdit = scopeInterdit(s.cle);
              return (
                <label
                  key={s.cle}
                  className={`check-row items-start ${interdit ? 'opacity-40' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="check-box mt-0.5"
                    checked={!interdit && scopes.includes(s.cle)}
                    disabled={interdit}
                    onChange={() => basculer(s.cle)}
                  />
                  <span>
                    {s.libelle}
                    <span className="ml-1 font-mono text-[11px] text-black/40 dark:text-white/40">
                      {s.cle}
                    </span>
                    {s.avertissement && (
                      <span className="block text-[11px] font-normal text-black/45 dark:text-white/45">
                        {s.avertissement}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Libellé" optional hint="Pour vous repérer entre deux clés pendant une rotation.">
          <input
            className="input-basic"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Production — rotation septembre"
          />
        </Field>

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi || retenus.length === 0}>
            <KeyRound size={15} /> Émettre
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ModaleCleEmise({ cle, onClose }: { cle: string; onClose: () => void }) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    try {
      await navigator.clipboard.writeText(cle);
      setCopie(true);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : la clé
      // reste sélectionnable à la main juste au-dessus, il n'y a rien à
      // rattraper ici.
    }
  }

  return (
    <Modal title="Clé émise" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Cette valeur n’existe que sur cet écran : seule son empreinte est enregistrée. Une fois
            cette fenêtre fermée, elle ne peut plus être retrouvée — seulement réémise.
          </span>
        </div>

        <code className="block break-all rounded-xl bg-black/[0.05] px-4 py-3 font-mono text-sm dark:bg-white/10">
          {cle}
        </code>

        <div className="btn-row justify-end">
          <button className="btn-outline" onClick={() => void copier()}>
            {copie ? <Check size={15} /> : <Copy size={15} />} {copie ? 'Copiée' : 'Copier'}
          </button>
          <button className="btn-primary" onClick={onClose}>
            J’ai transmis la clé
          </button>
        </div>
      </div>
    </Modal>
  );
}
