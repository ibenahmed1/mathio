'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MoreVertical, Plus, ShieldCheck, ShieldOff, SquarePen, Trash2 } from 'lucide-react';
import { apiDelete, apiPatch, apiPost } from '@/lib/api-client';
import {
  ActionsMenuPanel,
  actionsMenuItemClass,
  actionsMenuItemDangerClass,
} from '@/components/ActionsMenuPanel';
import { ModaleConfirmation } from '@/components/admin/ModaleConfirmation';
import { ModaleModifierCle } from '@/components/admin/integrations/ModaleModifierCle';
import { MenuActionsCle, type ActionCle } from '@/components/admin/integrations/MenuActionsCle';
import { badgeCle, dateCourte, horodatageCourt } from '@/components/admin/integrations/format';
import type { CleApi, PlateformeDetail } from '@/lib/types';

// Panneau de détail d'un compte machine.
//
// Il existe pour trois questions qu'on se pose toujours dans cet ordre quand
// une intégration se plaint : quelles clés sont valides, quels marchands sont
// réellement liés, et qu'est-ce qui est arrivé sur le fil ces dernières
// minutes. D'où les trois blocs, et pas un de plus — le quatrième, le bac à
// sable, n'apparaît que s'il a quelque chose à montrer.

/** Un geste destructeur en attente de confirmation. */
interface Confirmation {
  titre: string;
  corps: ReactNode;
  libelleAction: string;
  danger: boolean;
  executer: () => Promise<void>;
}

export function PanneauDetail({
  detail,
  onNouvelleCle,
  onModifier,
  onChange,
  onSupprime,
}: {
  detail: PlateformeDetail;
  onNouvelleCle: () => void;
  onModifier: () => void;
  onChange: () => void;
  onSupprime: () => void;
}) {
  const ancreMenu = useRef<HTMLButtonElement | null>(null);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [cleAModifier, setCleAModifier] = useState<CleApi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Les gestes sans confirmation passent par ici : une erreur s'affiche dans le
  // bandeau du panneau plutôt que dans un `alert()` détaché du geste. Ceux qui
  // en demandent une la laissent remonter — la modale l'affiche en place et
  // reste ouverte.
  async function agir(action: () => Promise<unknown>) {
    setErreur(null);
    try {
      await action();
      onChange();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action impossible');
    }
  }

  function surActionCle(cle: CleApi, action: ActionCle) {
    if (action === 'modifier') {
      setCleAModifier(cle);
      return;
    }

    const prefixe = `mtk_${cle.environnement}_${cle.prefixe}…`;

    if (action === 'annuler-expiration') {
      void agir(() =>
        apiPatch(`/api/plateformes/${detail.id}/cles/${cle.id}`, { action: 'annuler-expiration' })
      );
      return;
    }

    if (action === 'expirer') {
      setConfirmation({
        titre: 'Programmer l’expiration',
        danger: false,
        libelleAction: 'Programmer',
        corps: (
          <>
            La clé <code>{prefixe}</code> continuera de fonctionner pendant 7 jours, avec un en-tête
            de dépréciation sur chaque appel. C’est la moitié « ancienne clé » d’une rotation :
            émettre la nouvelle avant, pour que le partenaire ait le temps de la déployer.
          </>
        ),
        executer: async () => {
          await apiPatch(`/api/plateformes/${detail.id}/cles/${cle.id}`, { action: 'expirer' });
          onChange();
          setConfirmation(null);
        },
      });
      return;
    }

    if (action === 'revoquer') {
      setConfirmation({
        titre: 'Révoquer la clé',
        danger: true,
        libelleAction: 'Révoquer',
        corps: (
          <>
            La clé <code>{prefixe}</code> cessera de fonctionner <strong>immédiatement</strong>, sans
            préavis pour le partenaire. C’est le geste d’une clé compromise ; pour une rotation
            planifiée, préférer « Expirer dans 7 jours ». La révocation ne s’annule pas.
          </>
        ),
        executer: async () => {
          await apiPatch(`/api/plateformes/${detail.id}/cles/${cle.id}`, { action: 'revoquer' });
          onChange();
          setConfirmation(null);
        },
      });
      return;
    }

    setConfirmation({
      titre: 'Supprimer la clé',
      danger: true,
      libelleAction: 'Supprimer',
      corps: (
        <>
          La clé <code>{prefixe}</code> n’a jamais servi : sa ligne peut disparaître sans effacer de
          trace exploitable. Si elle a été transmise à quelqu’un, la supprimer ne le préviendra pas —
          elle cessera simplement de fonctionner.
        </>
      ),
      executer: async () => {
        await apiDelete(`/api/plateformes/${detail.id}/cles/${cle.id}`);
        onChange();
        setConfirmation(null);
      },
    });
  }

  function demanderPurge() {
    const v = detail.volumeTest;
    setConfirmation({
      titre: 'Purger le bac à sable',
      danger: true,
      libelleAction: 'Purger',
      corps: (
        <>
          Supprimer définitivement <strong>{v.marchands} marchand(s)</strong> et{' '}
          <strong>{v.colis} colis</strong> créés en environnement test. Les données de production ne
          sont pas touchées, et les marchands qui existaient déjà chez nous avant d’être rattachés
          sont conservés. Cette suppression est irréversible.
        </>
      ),
      executer: async () => {
        await apiPost(`/api/plateformes/${detail.id}/purge-test`);
        onChange();
        setConfirmation(null);
      },
    });
  }

  function demanderSuspension() {
    // Réactiver est un geste anodin : il ne coupe rien et se refait. Seule la
    // suspension mérite d'être confirmée.
    if (!detail.actif) {
      void agir(() => apiPatch(`/api/plateformes/${detail.id}`, { actif: true }));
      return;
    }
    setConfirmation({
      titre: 'Suspendre la plateforme',
      danger: true,
      libelleAction: 'Suspendre',
      corps: (
        <>
          Toutes les clés de <strong>{detail.nom}</strong> cessent immédiatement de fonctionner, sans
          être révoquées. C’est l’interrupteur à tirer pendant un incident, quand on ne sait pas
          encore laquelle est en cause : réactiver les remet en service, sans rien réémettre.
        </>
      ),
      executer: async () => {
        await apiPatch(`/api/plateformes/${detail.id}`, { actif: false });
        onChange();
        setConfirmation(null);
      },
    });
  }

  function demanderSuppression() {
    setConfirmation({
      titre: 'Supprimer le partenaire',
      danger: true,
      libelleAction: 'Supprimer définitivement',
      corps: (
        <>
          <strong>{detail.nom}</strong> et son compte de service seront supprimés, avec ses clés et
          son journal d’appels. Ce compte n’a jamais rien écrit dans l’historique d’un colis, donc
          rien de réel ne part avec lui — mais la suppression ne s’annule pas, et toute clé encore
          en circulation cessera de fonctionner sans préavis.
        </>
      ),
      executer: async () => {
        await apiDelete(`/api/plateformes/${detail.id}`);
        setConfirmation(null);
        onSupprime();
      },
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-black tracking-tight">{detail.nom}</h2>
          <p className="page-subtitle [overflow-wrap:anywhere]">
            Créée le {dateCourte(detail.dateCreation)} · code <code>{detail.code}</code>
          </p>
        </div>
        <div className="btn-row">
          <button className="btn-primary btn-sm" onClick={onNouvelleCle}>
            <Plus size={15} /> Émettre une clé
          </button>
          <button
            ref={ancreMenu}
            type="button"
            className="btn-outline btn-sm"
            aria-label="Actions sur le partenaire"
            onClick={() => setMenuOuvert((o) => !o)}
          >
            <MoreVertical size={16} />
          </button>
          <ActionsMenuPanel
            anchorRef={ancreMenu}
            open={menuOuvert}
            onClose={() => setMenuOuvert(false)}
            width={248}
          >
            <button
              className={actionsMenuItemClass}
              onClick={() => {
                setMenuOuvert(false);
                onModifier();
              }}
            >
              <SquarePen className="h-4 w-4" /> Modifier
            </button>
            <button
              className={detail.actif ? actionsMenuItemDangerClass : actionsMenuItemClass}
              onClick={() => {
                setMenuOuvert(false);
                demanderSuspension();
              }}
            >
              {detail.actif ? (
                <>
                  <ShieldOff className="h-4 w-4" /> Suspendre
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Réactiver
                </>
              )}
            </button>
            {/* La suppression n'est proposée que lorsqu'elle peut aboutir. Le
                serveur en donne la raison quand elle ne le peut pas : elle
                s'affiche sous le menu plutôt que de laisser cliquer sur un
                bouton qui finira en 409. */}
            {detail.modifiables.suppression && (
              <button
                className={actionsMenuItemDangerClass}
                onClick={() => {
                  setMenuOuvert(false);
                  demanderSuppression();
                }}
              >
                <Trash2 className="h-4 w-4" /> Supprimer
              </button>
            )}
          </ActionsMenuPanel>
        </div>
      </div>

      {detail.modifiables.raisonSuppression && (
        <p className="text-xs text-black/50 dark:text-white/50">
          <strong>Suppression impossible.</strong> {detail.modifiables.raisonSuppression}
        </p>
      )}

      {erreur && <p className="form-error">{erreur}</p>}

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
                  <th className="cell-actions"></th>
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
                        <span className="font-mono text-xs">
                          mtk_{cle.environnement}_{cle.prefixe}…
                        </span>
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
                        <div className="flex justify-end">
                          <MenuActionsCle cle={cle} onAction={(a) => surActionCle(cle, a)} />
                        </div>
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
              et <span className="font-bold">{detail.volumeTest.colis} colis</span> créés en
              environnement test, dans les tables réelles.
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
            <button className="btn-danger btn-sm ml-auto" onClick={demanderPurge}>
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
                      <span
                        className={
                          a.statut < 400 ? 'badge badge-ok' : a.statut < 500 ? 'badge badge-warn' : 'badge badge-danger'
                        }
                      >
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

      {cleAModifier && (
        <ModaleModifierCle
          plateformeId={detail.id}
          cle={cleAModifier}
          onClose={() => setCleAModifier(null)}
          onEnregistre={() => {
            setCleAModifier(null);
            onChange();
          }}
        />
      )}

      {confirmation && (
        <ModaleConfirmation
          titre={confirmation.titre}
          libelleAction={confirmation.libelleAction}
          danger={confirmation.danger}
          onConfirmer={confirmation.executer}
          onClose={() => setConfirmation(null)}
        >
          {confirmation.corps}
        </ModaleConfirmation>
      )}
    </div>
  );
}
