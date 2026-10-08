'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, BellRing, CheckCheck, MonitorSmartphone } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api-client';
import {
  LIBELLES_FAMILLE,
  definitionNotification,
  type FamilleNotification,
  type TypeNotificationDef,
} from '@/lib/notifications-catalogue';
import { BandeauPush, ICONE_FAMILLE, depuis, lienSur } from './affichage';
import { useNotifications, type NotificationCloche } from './NotificationsProvider';

// § Notifications — le centre de notifications, même page dans les quatre
// espaces (/admin, /marchand, /livreur, /ramasseur + /notifications) :
//   - l'historique complet de la cloche, filtrable lues / non lues ;
//   - les préférences : pour chaque type, la cloche ET le push, réglés
//     séparément (décision du 06/10/2026).
// Rendue sous la coquille de l'espace, donc sous son NotificationsProvider :
// marquer comme lu ici éteint aussi la pastille de la barre latérale.

type Onglet = 'toutes' | 'non_lues' | 'preferences';

const ONGLETS: { cle: Onglet; libelle: string }[] = [
  { cle: 'toutes', libelle: 'Toutes' },
  { cle: 'non_lues', libelle: 'Non lues' },
  { cle: 'preferences', libelle: 'Préférences' },
];

export function CentreNotifications() {
  const router = useRouter();
  const pathname = usePathname();
  const recherche = useSearchParams();
  const demande = recherche.get('onglet');
  const onglet: Onglet = demande === 'non_lues' || demande === 'preferences' ? demande : 'toutes';
  const { nonLues } = useNotifications();

  // L'onglet vit dans l'URL : le lien « Choisir mes notifications » du
  // panneau y mène directement, et un retour arrière y ramène.
  function choisir(cle: Onglet) {
    router.replace(cle === 'toutes' ? pathname : `${pathname}?onglet=${cle}`, { scroll: false });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <h1 className="page-title">Notifications</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Tout ce qui vous concerne dans l&apos;application, et ce que vous choisissez de recevoir.
        </p>
      </div>

      <div className="flex gap-1 border-b border-black/10 dark:border-white/10" role="tablist">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            type="button"
            role="tab"
            aria-selected={onglet === o.cle}
            onClick={() => choisir(o.cle)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition ${
              onglet === o.cle
                ? 'border-black text-black dark:border-white dark:text-white'
                : 'border-transparent text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'
            }`}
          >
            {o.libelle}
            {o.cle === 'non_lues' && nonLues > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-[0.625rem] font-bold leading-4 text-white">
                {nonLues > 99 ? '99+' : nonLues}
              </span>
            )}
          </button>
        ))}
      </div>

      {onglet === 'preferences' ? <Preferences /> : <Historique key={onglet} nonLuesSeulement={onglet === 'non_lues'} />}
    </div>
  );
}

// --- Historique -------------------------------------------------------------

interface Page {
  notifications: NotificationCloche[];
  nonLues: number;
  suite: boolean;
}

function Historique({ nonLuesSeulement }: { nonLuesSeulement: boolean }) {
  const router = useRouter();
  const { nonLues, marquerLues } = useNotifications();
  const [liste, setListe] = useState<NotificationCloche[]>([]);
  const [suite, setSuite] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(
    async (avant?: string) => {
      const params = new URLSearchParams();
      if (nonLuesSeulement) params.set('etat', 'non_lues');
      if (avant) params.set('avant', avant);
      const requete = params.toString();
      return apiGet<Page>(`/api/notifications${requete ? `?${requete}` : ''}`);
    },
    [nonLuesSeulement]
  );

  useEffect(() => {
    let actif = true;
    charger()
      .then((page) => {
        if (!actif) return;
        setListe(page.notifications);
        setSuite(page.suite);
      })
      .catch(() => actif && setErreur('Impossible de charger les notifications.'))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [charger]);

  async function plus() {
    const derniere = liste[liste.length - 1];
    if (!derniere) return;
    const page = await charger(derniere.creeLe);
    setListe((l) => [...l, ...page.notifications.filter((n) => !l.some((a) => a.id === n.id))]);
    setSuite(page.suite);
  }

  function marquerLocal(ids: string[] | 'tout') {
    const maintenant = new Date().toISOString();
    setListe((l) =>
      nonLuesSeulement
        ? l.filter((n) => ids !== 'tout' && !ids.includes(n.id))
        : l.map((n) => (!n.lueLe && (ids === 'tout' || ids.includes(n.id)) ? { ...n, lueLe: maintenant } : n))
    );
  }

  function ouvrir(n: NotificationCloche) {
    if (!n.lueLe) {
      void marquerLues([n.id]);
      marquerLocal([n.id]);
    }
    const lien = lienSur(n.lien);
    if (lien) router.push(lien);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-950">
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/10">
        <p className="text-xs font-semibold text-black/50 dark:text-white/50">
          {nonLues > 0 ? `${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Tout est lu'}
        </p>
        {nonLues > 0 && (
          <button
            type="button"
            onClick={() => {
              void marquerLues('tout');
              marquerLocal('tout');
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-black/60 hover:bg-black/5 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Tout marquer comme lu
          </button>
        )}
      </div>

      {erreur && <p className="px-4 py-6 text-sm font-medium text-red-600">{erreur}</p>}
      {chargement && <p className="px-4 py-10 text-center text-sm text-black/50 dark:text-white/50">Chargement…</p>}
      {!chargement && !erreur && liste.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-black/50 dark:text-white/50">
          <Bell className="h-7 w-7 opacity-40" />
          {nonLuesSeulement ? 'Aucune notification non lue.' : "Aucune notification pour l'instant."}
        </div>
      )}

      <ul>
        {liste.map((n) => {
          const def = definitionNotification(n.type);
          const Icone = def ? ICONE_FAMILLE[def.famille] : Bell;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => ouvrir(n)}
                className={`flex w-full items-start gap-3 border-b border-black/[0.04] px-4 py-3.5 text-left transition hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/5 ${
                  n.lueLe ? '' : 'bg-brand/[0.06]'
                }`}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/80">
                  <Icone className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.lueLe ? 'font-medium' : 'font-bold'}`}>{n.titre}</span>
                  {n.corps && <span className="mt-0.5 block text-xs text-black/60 dark:text-white/60">{n.corps}</span>}
                  <span className="mt-1 block text-[0.6875rem] text-black/40 dark:text-white/40">
                    {def?.libelle ?? n.type} · {depuis(n.creeLe)}
                  </span>
                </span>
                {!n.lueLe && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="Non lue" />}
              </button>
            </li>
          );
        })}
      </ul>

      {suite && (
        <div className="p-2">
          <button
            type="button"
            onClick={() => void plus()}
            className="w-full rounded-md py-2 text-xs font-semibold text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
          >
            Afficher plus
          </button>
        </div>
      )}
    </div>
  );
}

// --- Préférences ------------------------------------------------------------

interface Prefs {
  types: TypeNotificationDef[];
  pushCoupes: string[];
  clocheCoupes: string[];
}

function Interrupteur({
  actif,
  desactive,
  onChange,
  libelle,
}: {
  actif: boolean;
  desactive?: boolean;
  onChange: () => void;
  libelle: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      title={libelle}
      disabled={desactive}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
        actif ? 'bg-black dark:bg-white' : 'bg-black/15 dark:bg-white/20'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition dark:bg-neutral-900 ${
          actif ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Preferences() {
  const { push, activer } = useNotifications();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etatEnregistrement, setEtatEnregistrement] = useState<'idle' | 'en_cours' | 'ok'>('idle');
  const [activation, setActivation] = useState(false);

  useEffect(() => {
    apiGet<Prefs>('/api/notifications/preferences')
      .then(setPrefs)
      .catch(() => setErreur('Impossible de charger vos préférences.'));
  }, []);

  async function basculer(canal: 'cloche' | 'push', cle: string) {
    if (!prefs) return;
    const champ = canal === 'cloche' ? 'clocheCoupes' : 'pushCoupes';
    const avant = prefs;
    const liste = prefs[champ].includes(cle) ? prefs[champ].filter((c) => c !== cle) : [...prefs[champ], cle];
    // Optimiste : l'interrupteur doit bouger au clic. En cas d'échec, on
    // revient à l'état connu du serveur.
    setPrefs({ ...prefs, [champ]: liste });
    setEtatEnregistrement('en_cours');
    try {
      const enregistre = await apiPut<{ pushCoupes: string[]; clocheCoupes: string[] }>(
        '/api/notifications/preferences',
        { [champ]: liste }
      );
      setPrefs((p) => (p ? { ...p, ...enregistre } : p));
      setEtatEnregistrement('ok');
      setErreur(null);
    } catch {
      setPrefs(avant);
      setEtatEnregistrement('idle');
      setErreur("L'enregistrement a échoué. Réessayez.");
    }
  }

  async function activerIci() {
    setActivation(true);
    try {
      await activer();
    } finally {
      setActivation(false);
    }
  }

  if (erreur && !prefs) return <p className="text-sm font-medium text-red-600">{erreur}</p>;
  if (!prefs) return <p className="text-sm text-black/50 dark:text-white/50">Chargement…</p>;

  const familles = [...new Set(prefs.types.map((t) => t.famille))] as FamilleNotification[];

  return (
    <div className="flex flex-col gap-5">
      {/* L'appareil : le push se choisit par type ci-dessous, mais il ne
          part que vers les appareils où il a été ACTIVÉ. */}
      <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-950">
        <div className="flex items-start gap-3 px-4 py-3">
          <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-black/60 dark:text-white/60" />
          <div className="text-sm">
            <p className="font-semibold">Cet appareil</p>
            <p className="text-black/60 dark:text-white/60">
              {push === 'actif' && 'Les alertes push sont activées sur ce navigateur.'}
              {push === 'a_activer' && "Les alertes push ne sont pas encore activées sur ce navigateur."}
              {push === 'refuse' && 'Les notifications sont bloquées par le navigateur pour ce site.'}
              {push === 'indisponible' && "Ce navigateur ne reçoit pas d'alertes push. La cloche reste disponible."}
              {push === 'non_configure' && "Les alertes push ne sont pas disponibles pour le moment. La cloche reste disponible."}
              {push === null && 'Vérification…'}
            </p>
          </div>
        </div>
        <BandeauPush etat={push} enCours={activation} onActiver={activerIci} />
      </div>

      <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-neutral-950">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-black/[0.06] px-4 py-2.5 text-xs font-semibold text-black/50 dark:border-white/10 dark:text-white/50 sm:gap-x-8">
          <span>Type de notification</span>
          <span className="flex w-16 flex-col items-center gap-0.5 text-center">
            <Bell className="h-3.5 w-3.5" />
            Application
          </span>
          <span className="flex w-16 flex-col items-center gap-0.5 text-center">
            <BellRing className="h-3.5 w-3.5" />
            Push
          </span>
        </div>

        {familles.map((famille) => {
          const Icone = ICONE_FAMILLE[famille];
          return (
            <div key={famille}>
              <p className="flex items-center gap-2 bg-black/[0.02] px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wide text-black/50 dark:bg-white/[0.03] dark:text-white/50">
                <Icone className="h-3.5 w-3.5" />
                {LIBELLES_FAMILLE[famille]}
              </p>
              {prefs.types
                .filter((t) => t.famille === famille)
                .map((t) => (
                  <div
                    key={t.cle}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-black/[0.04] px-4 py-3 dark:border-white/5 sm:gap-x-8"
                  >
                    <span className="text-sm">
                      {t.libelle}
                      {!t.push && (
                        <span className="mt-0.5 block text-xs text-black/45 dark:text-white/45">
                          Dans l&apos;application seulement, pour ne pas multiplier les alertes.
                        </span>
                      )}
                    </span>
                    <span className="flex w-16 justify-center">
                      <Interrupteur
                        actif={!prefs.clocheCoupes.includes(t.cle)}
                        onChange={() => void basculer('cloche', t.cle)}
                        libelle={`${t.libelle} — dans l'application`}
                      />
                    </span>
                    <span className="flex w-16 justify-center">
                      <Interrupteur
                        actif={t.push && !prefs.pushCoupes.includes(t.cle)}
                        desactive={!t.push}
                        onChange={() => void basculer('push', t.cle)}
                        libelle={t.push ? `${t.libelle} — en push` : `${t.libelle} — jamais envoyé en push`}
                      />
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-black/50 dark:text-white/50" aria-live="polite">
        {erreur ?? (etatEnregistrement === 'en_cours' ? 'Enregistrement…' : etatEnregistrement === 'ok' ? 'Préférences enregistrées.' : 'Chaque changement est enregistré aussitôt.')}
      </p>
    </div>
  );
}
