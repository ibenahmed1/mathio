'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  Unplug,
  Webhook,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { IntegrationYoucan } from '@/components/marchand/IntegrationYoucan';

// § Intégration Shopify — le marchand connecte SA boutique : ses commandes
// deviennent des colis dans cet espace, son catalogue ses Marchandises.
//
// Les secrets saisis ici ne reviennent JAMAIS vers le navigateur : l'API ne
// renvoie que l'état de la boutique (lib/shopify.ts, EtatBoutiqueShopify).
// Les modifier, c'est les ressaisir.
//
// § Intégration YouCan : bloc à part (components/marchand/IntegrationYoucan),
// connecté par OAuth, sans saisie.

interface Reception {
  horodatage: string;
  issue: string;
  reference: string | null;
  message: string | null;
}

interface EtatBoutique {
  domaine: string;
  nom: string | null;
  devise: string | null;
  connectee: boolean;
  connecteeLe: string;
  deconnecteeLe: string | null;
  webhookActif: boolean;
  urlWebhook: string | null;
  derniereSynchroProduitsLe: string | null;
  derniereErreur: string | null;
  nbColis: number;
  nbMarchandises: number;
  receptions: Reception[];
}

interface InfosBoutique {
  domaine: string;
  nom: string;
  devise: string;
  acces: string[];
}

interface Synchro {
  variantes: number;
  creees: number;
  misesAJour: number;
  rattachees: number;
}

const LIBELLES_ISSUE: Record<string, { texte: string; classe: string }> = {
  cree: { texte: 'Colis créé', classe: 'badge-ok' },
  deja_recu: { texte: 'Déjà reçue', classe: 'badge-neutral' },
  ignore: { texte: 'Ignorée', classe: 'badge-neutral' },
  rejete: { texte: 'Rejetée', classe: 'badge-danger' },
  erreur: { texte: 'Erreur', classe: 'badge-warn' },
};

function dateHeure(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function resumeSynchro(s: Synchro): string {
  const parties = [`${s.variantes} article${s.variantes > 1 ? 's' : ''} lu${s.variantes > 1 ? 's' : ''}`];
  if (s.creees) parties.push(`${s.creees} ajouté${s.creees > 1 ? 's' : ''}`);
  if (s.misesAJour) parties.push(`${s.misesAJour} mis à jour`);
  if (s.rattachees) parties.push(`${s.rattachees} rattaché${s.rattachees > 1 ? 's' : ''} à une marchandise existante`);
  return parties.join(', ');
}

function ChampSecret({
  label,
  valeur,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="form-field">
      <span className="form-label">
        {label}
        <span className="form-required">*</span>
      </span>
      <span className="relative flex">
        <input
          className="input-basic w-full pr-10 font-mono text-sm"
          type={visible ? 'text' : 'password'}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-3 opacity-60 hover:opacity-100"
          aria-label={visible ? `Masquer ${label}` : `Afficher ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
      <span className="form-hint">{hint}</span>
    </label>
  );
}

export default function IntegrationsPage() {
  const [chargement, setChargement] = useState(true);
  const [boutique, setBoutique] = useState<EtatBoutique | null>(null);
  const [urlPubliqueConfiguree, setUrlPubliqueConfiguree] = useState(true);
  const [edition, setEdition] = useState(false);

  const [domaine, setDomaine] = useState('');
  const [jeton, setJeton] = useState('');
  const [cleSecrete, setCleSecrete] = useState('');
  // Empreinte de la saisie testée avec succès : « Connecter » n'est proposé
  // que pour CETTE saisie — la modifier après le test redemande un test.
  const [saisieTestee, setSaisieTestee] = useState<string | null>(null);
  const [infosTest, setInfosTest] = useState<InfosBoutique | null>(null);

  const [action, setAction] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const empreinte = `${domaine.trim()}\n${jeton.trim()}\n${cleSecrete.trim()}`;
  const testValide = saisieTestee === empreinte && infosTest !== null;

  const charger = useCallback(async () => {
    try {
      const res = await apiGet<{ boutique: EtatBoutique | null; urlPubliqueConfiguree: boolean }>(
        '/api/integrations/shopify'
      );
      setBoutique(res.boutique);
      setUrlPubliqueConfiguree(res.urlPubliqueConfiguree);
      if (res.boutique && !domaine) setDomaine(res.boutique.domaine);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
    // `domaine` volontairement hors dépendances : ne pré-remplir qu'au chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Différé d'un tick, comme les autres écrans marchand : pas de setState
    // synchrone dans le corps de l'effet.
    Promise.resolve().then(() => charger());
  }, [charger]);

  async function executer(nom: string, operation: () => Promise<void>) {
    setAction(nom);
    setErreur(null);
    setSucces(null);
    try {
      await operation();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Opération impossible');
    } finally {
      setAction(null);
    }
  }

  const tester = () =>
    executer('tester', async () => {
      setInfosTest(null);
      setSaisieTestee(null);
      const res = await apiPost<{ infos: InfosBoutique }>('/api/integrations/shopify/tester', {
        domaine,
        jeton,
        cleSecrete,
      });
      setInfosTest(res.infos);
      setDomaine(res.infos.domaine);
      // Le domaine renvoyé par Shopify peut différer de la saisie (casse,
      // URL collée) : l'empreinte doit suivre, sinon le test paraîtrait périmé.
      setSaisieTestee(`${res.infos.domaine}\n${jeton.trim()}\n${cleSecrete.trim()}`);
    });

  const connecter = () =>
    executer('connecter', async () => {
      const res = await apiPost<{ boutique: EtatBoutique; synchro: Synchro | null; erreurSynchro: string | null }>(
        '/api/integrations/shopify',
        { domaine, jeton, cleSecrete }
      );
      setBoutique(res.boutique);
      setJeton('');
      setCleSecrete('');
      setInfosTest(null);
      setSaisieTestee(null);
      setEdition(false);
      setSucces(
        res.synchro
          ? `Boutique connectée. Produits : ${resumeSynchro(res.synchro)}.`
          : `Boutique connectée. L’import des produits a échoué : ${res.erreurSynchro ?? 'raison inconnue'}.`
      );
    });

  const synchroniser = () =>
    executer('synchroniser', async () => {
      const res = await apiPost<{ synchro: Synchro }>('/api/integrations/shopify/produits');
      setSucces(`Produits synchronisés : ${resumeSynchro(res.synchro)}.`);
      await charger();
    });

  const rattraper = () =>
    executer('rattraper', async () => {
      const res = await apiPost<{
        rattrapage: { lues: number; creees: number; dejaRecues: number; ignorees: number; rejetees: number };
        boutique: EtatBoutique;
      }>('/api/integrations/shopify/commandes');
      setBoutique(res.boutique);
      const r = res.rattrapage;
      setSucces(
        r.lues === 0
          ? 'Aucune commande sur les 7 derniers jours.'
          : `${r.lues} commande(s) lue(s) sur 7 jours : ${r.creees} colis créé(s), ${r.dejaRecues} déjà reçue(s)` +
              (r.ignorees ? `, ${r.ignorees} ignorée(s)` : '') +
              (r.rejetees ? `, ${r.rejetees} en échec (voir le journal)` : '') +
              '.'
      );
    });

  const reessayerWebhook = () =>
    executer('webhook', async () => {
      const res = await apiPost<{ boutique: EtatBoutique }>('/api/integrations/shopify/webhook');
      setBoutique(res.boutique);
      if (res.boutique.webhookActif) setSucces('Webhook des commandes actif.');
    });

  const deconnecter = () => {
    if (
      !window.confirm(
        'Déconnecter la boutique ? Les nouvelles commandes Shopify ne créeront plus de colis. ' +
          'Les colis et marchandises déjà importés sont conservés.'
      )
    ) {
      return;
    }
    void executer('deconnecter', async () => {
      const res = await apiDelete<{ boutique: EtatBoutique | null }>('/api/integrations/shopify');
      setBoutique(res.boutique);
      setSucces('Boutique déconnectée.');
    });
  };

  const connectee = boutique?.connectee ?? false;
  const afficherFormulaire = !connectee || edition;

  return (
    <div className="flex flex-col gap-4">
      <div className="page-header">
        <h1 className="page-title">Intégrations</h1>
        <p className="page-subtitle">
          Branchez votre boutique en ligne : ses commandes deviennent automatiquement des colis dans votre espace.
        </p>
      </div>

      {erreur && (
        <div role="alert" className="flex max-w-3xl items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}
      {succes && (
        <div role="status" className="flex max-w-3xl items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{succes}</span>
        </div>
      )}

      <section className="form-section max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <Image src="/logos/shopify.svg" alt="" width={30} height={34} unoptimized />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Shopify</h2>
            <p className="text-xs opacity-60">Commandes → colis · Produits → marchandises</p>
          </div>
          {chargement ? (
            <Loader2 className="h-4 w-4 animate-spin opacity-60" />
          ) : connectee ? (
            <span className="badge badge-ok">Connectée</span>
          ) : boutique ? (
            <span className="badge badge-neutral">Déconnectée</span>
          ) : (
            <span className="badge badge-neutral">Non connectée</span>
          )}
        </div>

        {!chargement && connectee && boutique && (
          <div className="mt-4 flex flex-col gap-4">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs opacity-60">Boutique</dt>
                <dd className="font-semibold">{boutique.nom ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Domaine</dt>
                <dd className="break-all font-mono text-xs">{boutique.domaine}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Connectée le</dt>
                <dd>{dateHeure(boutique.connecteeLe)}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Devise</dt>
                <dd>
                  {boutique.devise ?? '—'}
                  {boutique.devise && boutique.devise !== 'MAD' && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                      montants repris sans conversion
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Colis créés depuis Shopify</dt>
                <dd className="font-semibold tabular-nums">{boutique.nbColis}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Marchandises importées</dt>
                <dd className="font-semibold tabular-nums">
                  {boutique.nbMarchandises}
                  <span className="ml-2 text-xs font-normal opacity-60">
                    synchro : {dateHeure(boutique.derniereSynchroProduitsLe)}
                  </span>
                </dd>
              </div>
            </dl>

            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                boutique.webhookActif
                  ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                  : 'border-amber-500/40 bg-amber-500/[0.08]'
              }`}
            >
              <Webhook className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                {boutique.webhookActif ? (
                  <p>
                    <strong>Réception des commandes active.</strong> Chaque nouvelle commande crée un colis
                    « Nouveau colis » dans votre espace.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>Les commandes n’arrivent pas encore.</strong>{' '}
                      {boutique.derniereErreur ?? 'Le webhook des commandes n’est pas enregistré chez Shopify.'}
                    </p>
                    {!urlPubliqueConfiguree && (
                      <p className="mt-1 text-xs opacity-70">
                        Cette étape dépend de la configuration de la plateforme : si le problème persiste, contactez
                        le support.
                      </p>
                    )}
                  </>
                )}
              </div>
              {!boutique.webhookActif && (
                <button onClick={reessayerWebhook} disabled={action !== null} className="btn-outline btn-sm shrink-0">
                  {action === 'webhook' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Réessayer'}
                </button>
              )}
            </div>

            <div className="btn-row flex flex-wrap gap-2">
              <button onClick={synchroniser} disabled={action !== null} className="btn-outline flex items-center gap-2">
                {action === 'synchroniser' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Synchroniser les produits
              </button>
              <button
                onClick={rattraper}
                disabled={action !== null}
                title="Importe les commandes des 7 derniers jours que le webhook n’a pas apportées (sans doublon)"
                className="btn-outline flex items-center gap-2"
              >
                {action === 'rattraper' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Récupérer les commandes récentes
              </button>
              <button
                onClick={() => {
                  setEdition((v) => !v);
                  setInfosTest(null);
                  setSaisieTestee(null);
                }}
                disabled={action !== null}
                className="btn-ghost"
              >
                {edition ? 'Annuler' : 'Modifier les identifiants'}
              </button>
              <button
                onClick={deconnecter}
                disabled={action !== null}
                className="btn-danger ml-auto flex items-center gap-2"
              >
                {action === 'deconnecter' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Déconnecter
              </button>
            </div>
          </div>
        )}

        {!chargement && afficherFormulaire && (
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (testValide) void connecter();
              else void tester();
            }}
          >
            {!connectee && (
              <p className="text-sm opacity-70">
                Ces trois informations se trouvent dans les identifiants de l’API de votre application Shopify.
                L’application doit avoir au moins les accès <code className="text-xs">read_orders</code> et{' '}
                <code className="text-xs">read_products</code>.
              </p>
            )}
            <div className="form-grid">
              <label className="form-field">
                <span className="form-label">
                  Domaine de la boutique<span className="form-required">*</span>
                </span>
                <input
                  className="input-basic font-mono text-sm"
                  value={domaine}
                  onChange={(e) => setDomaine(e.target.value)}
                  placeholder="ma-boutique.myshopify.com"
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={connectee}
                />
                <span className="form-hint">
                  {connectee
                    ? 'Pour connecter une autre boutique, déconnectez d’abord celle-ci.'
                    : 'Le domaine en .myshopify.com, pas votre nom de domaine personnalisé.'}
                </span>
              </label>
              <ChampSecret
                label="Jeton d’accès Admin API"
                valeur={jeton}
                onChange={setJeton}
                placeholder="shpat_…"
                hint="Affiché une seule fois par Shopify à l’installation de l’application."
              />
              <ChampSecret
                label="Clé secrète de l’API"
                valeur={cleSecrete}
                onChange={setCleSecrete}
                placeholder="shpss_…"
                hint="Sert à vérifier que les commandes reçues viennent bien de Shopify."
              />
            </div>

            {testValide && infosTest && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Connexion réussie : {infosTest.nom}
                </p>
                <p className="mt-1 text-xs opacity-75">
                  Devise {infosTest.devise} · accès : {infosTest.acces.join(', ')}
                </p>
                {infosTest.devise !== 'MAD' && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    La boutique n’est pas en dirhams : les montants seront repris tels quels, sans conversion, et
                    signalés dans la note du colis.
                  </p>
                )}
                <p className="mt-1 text-xs opacity-75">
                  La clé secrète ne peut pas être testée à l’avance : elle sera vérifiée à la première commande reçue.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={tester}
                disabled={action !== null || !domaine.trim() || !jeton.trim() || !cleSecrete.trim()}
                className="btn-outline flex items-center gap-2"
              >
                {action === 'tester' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Tester la connexion
              </button>
              <button
                type="button"
                onClick={connecter}
                disabled={action !== null || !testValide}
                title={testValide ? undefined : 'Testez d’abord la connexion'}
                className="btn-primary flex items-center gap-2"
              >
                {action === 'connecter' && <Loader2 className="h-4 w-4 animate-spin" />}
                {connectee ? 'Enregistrer les identifiants' : 'Connecter la boutique'}
              </button>
            </div>
          </form>
        )}
      </section>

      {!chargement && boutique && boutique.receptions.length > 0 && (
        <section className="form-section max-w-3xl">
          <h2 className="mb-2 text-sm font-bold">Dernières commandes reçues</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs opacity-60">
                  <th className="py-1 pr-3 font-medium">Reçue le</th>
                  <th className="py-1 pr-3 font-medium">Commande</th>
                  <th className="py-1 pr-3 font-medium">Issue</th>
                  <th className="py-1 font-medium">Détail</th>
                </tr>
              </thead>
              <tbody>
                {boutique.receptions.map((r, i) => {
                  const issue = LIBELLES_ISSUE[r.issue] ?? { texte: r.issue, classe: 'badge-neutral' };
                  return (
                    <tr key={`${r.horodatage}-${i}`} className="border-t border-black/5 align-top dark:border-white/10">
                      <td className="whitespace-nowrap py-1.5 pr-3">{dateHeure(r.horodatage)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{r.reference ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`badge ${issue.classe}`}>{issue.texte}</span>
                      </td>
                      <td className="py-1.5 text-xs opacity-80">{r.message ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <IntegrationYoucan />
    </div>
  );
}
