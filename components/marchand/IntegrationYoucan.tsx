'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  ShoppingBag,
  Unplug,
  Webhook,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';

// § Intégration YouCan (INTEGRATION_YOUCAN.md) — bloc de /marchand/integrations.
//
// Même parcours que Shopify : le marchand saisit les identifiants de SA
// propre application YouCan (Client ID / Client Secret), les teste, puis
// connecte. Seule différence : YouCan impose, au clic sur « Connecter », UNE
// autorisation sur son site, d'où il ramène ici avec
// `?youcan=connectee|erreur&message=…` (app/api/integrations/youcan/callback).
//
// Le Client Secret ne revient JAMAIS vers le navigateur.

interface Reception {
  horodatage: string;
  issue: string;
  reference: string | null;
  message: string | null;
}

interface EtatBoutique {
  clientId: string | null;
  nom: string | null;
  domaine: string | null;
  devise: string | null;
  connectee: boolean;
  connecteeLe: string;
  deconnecteeLe: string | null;
  webhookActif: boolean;
  derniereSynchroProduitsLe: string | null;
  derniereErreur: string | null;
  nbColis: number;
  nbMarchandises: number;
  receptions: Reception[];
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

export function IntegrationYoucan() {
  const [chargement, setChargement] = useState(true);
  const [boutique, setBoutique] = useState<EtatBoutique | null>(null);
  const [urlRetour, setUrlRetour] = useState('');
  const [urlPubliqueConfiguree, setUrlPubliqueConfiguree] = useState(true);
  const [edition, setEdition] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // Empreinte de la saisie testée avec succès : « Connecter » n'est proposé
  // que pour CETTE saisie, comme pour Shopify.
  const [saisieTestee, setSaisieTestee] = useState<string | null>(null);
  const [copiee, setCopiee] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const res = await apiGet<{ boutique: EtatBoutique | null; urlRetour: string; urlPubliqueConfiguree: boolean }>(
        '/api/integrations/youcan'
      );
      setBoutique(res.boutique);
      setUrlRetour(res.urlRetour);
      setUrlPubliqueConfiguree(res.urlPubliqueConfiguree);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      // Retour d'OAuth : le message est affiché une fois, puis retiré de l'URL
      // pour qu'un rechargement ne le rejoue pas.
      const params = new URLSearchParams(window.location.search);
      const issue = params.get('youcan');
      const message = params.get('message');
      if (issue && message) {
        if (issue === 'connectee') setSucces(message);
        else setErreur(message);
        params.delete('youcan');
        params.delete('message');
        const reste = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${reste ? `?${reste}` : ''}`);
      }
      return charger();
    });
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

  const empreinte = `${clientId.trim()}
${clientSecret.trim()}`;
  const testValide = saisieTestee === empreinte;

  const tester = () =>
    executer('tester', async () => {
      setSaisieTestee(null);
      await apiPost('/api/integrations/youcan/tester', { clientId, clientSecret });
      setSaisieTestee(empreinte);
    });

  // Les identifiants partent au serveur, qui les scelle dans le cookie de
  // l'aller-retour ; le NAVIGATEUR va ensuite sur YouCan autoriser la boutique.
  const connecter = () =>
    executer('connecter', async () => {
      const res = await apiPost<{ url: string }>('/api/integrations/youcan/connecter', { clientId, clientSecret });
      setAction('connecter');
      window.location.assign(res.url);
      // La page quitte l'écran : le bouton reste en attente jusque-là.
      await new Promise(() => {});
    });

  const copierUrlRetour = async () => {
    try {
      await navigator.clipboard.writeText(urlRetour);
      setCopiee(true);
      setTimeout(() => setCopiee(false), 2000);
    } catch {
      // Presse-papiers refusé : l'URL reste sélectionnable à la main.
    }
  };

  const synchroniser = () =>
    executer('synchroniser', async () => {
      const res = await apiPost<{ synchro: Synchro }>('/api/integrations/youcan/produits');
      setSucces(`Produits synchronisés : ${resumeSynchro(res.synchro)}.`);
      await charger();
    });

  const rattraper = () =>
    executer('rattraper', async () => {
      const res = await apiPost<{
        rattrapage: { lues: number; creees: number; dejaRecues: number; ignorees: number; rejetees: number };
        boutique: EtatBoutique;
      }>('/api/integrations/youcan/commandes');
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
      const res = await apiPost<{ boutique: EtatBoutique }>('/api/integrations/youcan/webhook');
      setBoutique(res.boutique);
      if (res.boutique.webhookActif) setSucces('Webhook des commandes actif.');
    });

  const deconnecter = () => {
    if (
      !window.confirm(
        'Déconnecter la boutique YouCan ? Les nouvelles commandes ne créeront plus de colis. ' +
          'Les colis et marchandises déjà importés sont conservés.'
      )
    ) {
      return;
    }
    void executer('deconnecter', async () => {
      const res = await apiDelete<{ boutique: EtatBoutique | null }>('/api/integrations/youcan');
      setBoutique(res.boutique);
      setSucces('Boutique YouCan déconnectée.');
    });
  };

  const connectee = boutique?.connectee ?? false;

  return (
    <>
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
          <span className="flex h-[34px] w-[30px] items-center justify-center text-violet-600 dark:text-violet-300">
            <ShoppingBag className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">YouCan</h2>
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
                <dd className="break-all font-mono text-xs">{boutique.domaine ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">Client ID de l’application</dt>
                <dd className="break-all font-mono text-xs">{boutique.clientId ?? '—'}</dd>
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
                <dt className="text-xs opacity-60">Colis créés depuis YouCan</dt>
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
                boutique.webhookActif && !boutique.derniereErreur
                  ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                  : 'border-amber-500/40 bg-amber-500/[0.08]'
              }`}
            >
              <Webhook className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                {boutique.webhookActif && !boutique.derniereErreur ? (
                  <p>
                    <strong>Réception des commandes active.</strong> Chaque nouvelle commande crée un colis
                    « Nouveau colis » dans votre espace.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>{boutique.webhookActif ? 'Attention.' : 'Les commandes n’arrivent pas encore.'}</strong>{' '}
                      {boutique.derniereErreur ?? 'Le webhook des commandes n’est pas enregistré chez YouCan.'}
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
                {action === 'synchroniser' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
                  setSaisieTestee(null);
                }}
                disabled={action !== null}
                className="btn-ghost"
              >
                {edition ? 'Annuler' : 'Modifier les identifiants'}
              </button>
              <button onClick={deconnecter} disabled={action !== null} className="btn-danger ml-auto flex items-center gap-2">
                {action === 'deconnecter' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Déconnecter
              </button>
            </div>
          </div>
        )}

        {!chargement && (!connectee || edition) && (
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
                Ces deux informations se trouvent dans votre application YouCan (Partner Dashboard → Apps). Réglez
                l’option <strong>Embedded</strong> sur <strong>False</strong> et déclarez l’URL de retour ci-dessous.
              </p>
            )}
            <div className="form-grid">
              <label className="form-field">
                <span className="form-label">
                  Client ID<span className="form-required">*</span>
                </span>
                <input
                  className="input-basic font-mono text-sm"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="cl_…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="form-hint">Identifiant public de votre application YouCan.</span>
              </label>
              <ChampSecret
                label="Client Secret"
                valeur={clientSecret}
                onChange={setClientSecret}
                placeholder="••••••••"
                hint="Sert aussi à vérifier que les commandes reçues viennent bien de YouCan."
              />
              <div className="form-field">
                <span className="form-label">URL de retour à déclarer dans l’application</span>
                <span className="flex items-stretch gap-2">
                  <input className="input-basic w-full font-mono text-xs" value={urlRetour} readOnly onFocus={(e) => e.target.select()} />
                  <button type="button" onClick={copierUrlRetour} className="btn-outline btn-sm flex shrink-0 items-center gap-1">
                    {copiee ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiee ? 'Copiée' : 'Copier'}
                  </button>
                </span>
                <span className="form-hint">À recopier à l’identique, sinon YouCan répond « Client authentication failed ».</span>
              </div>
            </div>

            {testValide && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Identifiants acceptés par YouCan
                </p>
                <p className="mt-1 text-xs opacity-75">
                  « Connecter la boutique » vous amène sur YouCan pour autoriser l’accès à votre boutique, puis vous
                  ramène ici.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={tester}
                disabled={action !== null || !clientId.trim() || !clientSecret.trim()}
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
                {connectee ? 'Enregistrer et réautoriser' : 'Connecter la boutique'}
              </button>
            </div>
          </form>
        )}
      </section>

      {!chargement && boutique && boutique.receptions.length > 0 && (
        <section className="form-section max-w-3xl">
          <h2 className="mb-2 text-sm font-bold">Dernières commandes YouCan reçues</h2>
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
    </>
  );
}
