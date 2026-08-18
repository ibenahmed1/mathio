'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, PackageCheck, ScanLine, Share2, Undo2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonDistribution, Commande } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';
import { StatutBadge } from '@/components/StatutBadge';

interface MeResponse {
  id: string;
  nomComplet: string;
  role: string;
  hub?: { id: string; nom: string } | null;
}

interface HubOption {
  id: string;
  nom: string;
}

type Mode = 'reception' | 'retour';

interface EntreeJournal {
  cle: string;
  heure: string;
  ton: 'ok' | 'info' | 'erreur';
  texte: string;
  commande?: Commande;
}

const MODES: { cle: Mode; label: string; icone: React.ComponentType<{ className?: string }>; aide: string }[] = [
  {
    cle: 'reception',
    label: 'Réception au hub',
    icone: PackageCheck,
    aide: "Colis déposé au quai par un ramasseur ou arrivé en transit : le scan le passe en « Reçu au hub » et le rend éligible à une prochaine tournée.",
  },
  {
    cle: 'retour',
    label: 'Retour de tournée',
    icone: Undo2,
    aide: 'Colis non livré ramené par le livreur : le scan le repasse physiquement au dépôt (« Retourné au hub ») sans écraser le motif terrain.',
  },
];

function heureCourante() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// § /planner/scan — poste de scan du Planner.
//
// C'est l'écran qui lui donne la main sur le quai : les deux scans de son
// métier, au même endroit, avec la caméra du téléphone/de la tablette (ou une
// douchette via la saisie manuelle intégrée à <QrScanner />).
//   • Réception au hub  -> POST /api/commandes/scan-reception
//   • Retour de tournée -> POST /api/bons-distribution/[id]/scan-retour
//
// Aucune logique métier ici : les deux endpoints existants restent seuls
// juges (statuts autorisés, idempotence du rejeu, historisation, périmètre du
// hub). Le mode est explicite plutôt que déduit du statut du colis — au quai,
// le Planner sait ce qu'il est en train de faire, et un mode figé évite qu'un
// code mal lu déclenche la mauvaise transition.
export default function PlannerScanPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mode, setMode] = useState<Mode>('reception');
  const [journal, setJournal] = useState<EntreeJournal[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  // Réception : un planner scanne toujours pour son propre hub (résolu côté
  // serveur) ; un admin sans hub de rattachement doit en choisir un.
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [hubChoisiId, setHubChoisiId] = useState('');

  // Retour : le scan est rattaché à une tournée précise — un colis ne peut
  // rentrer que dans celle qui l'a emporté (vérifié côté serveur).
  const [tournees, setTournees] = useState<BonDistribution[]>([]);
  const [tourneeId, setTourneeId] = useState('');

  useEffect(() => {
    apiGet<MeResponse>('/api/auth/me')
      .then(setMe)
      .catch(() => {});

    apiGet<{ data: BonDistribution[] }>('/api/bons-distribution?statut=en_cours&pageSize=100')
      .then((res) => setTournees(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!me || me.role !== 'admin' || me.hub) return;
    apiGet<{ data: HubOption[] }>('/api/hubs')
      .then((res) => setHubs(res.data))
      .catch(() => {});
  }, [me]);

  const besoinHubExplicite = Boolean(me && me.role === 'admin' && !me.hub);
  const hubLibelle = me?.hub?.nom ?? hubs.find((h) => h.id === hubChoisiId)?.nom ?? null;

  const modeCourant = MODES.find((m) => m.cle === mode)!;

  const bloquant = useMemo(() => {
    if (mode === 'reception' && besoinHubExplicite && !hubChoisiId) {
      return 'Choisissez le hub de réception avant de scanner.';
    }
    if (mode === 'retour' && !tourneeId) {
      return tournees.length === 0
        ? "Aucune tournée ouverte : il n'y a pas de retour à enregistrer."
        : 'Choisissez la tournée que le livreur vient de rentrer.';
    }
    return null;
  }, [mode, besoinHubExplicite, hubChoisiId, tourneeId, tournees.length]);

  function noter(entree: Omit<EntreeJournal, 'cle' | 'heure'>) {
    setJournal((prev) => [{ ...entree, cle: `${prev.length}-${prev[0]?.cle ?? 'init'}`, heure: heureCourante() }, ...prev]);
  }

  // Un payload QR signé contient un point, un code de suivi n'en contient
  // jamais — même heuristique que les autres écrans de scan de l'app.
  function corpsDuCode(raw: string): Record<string, unknown> {
    return raw.includes('.') ? { qrPayload: raw } : { codeSuivi: raw };
  }

  async function scanner(raw: string) {
    const code = raw.trim();
    if (!code || enCours || bloquant) return;
    setEnCours(true);
    try {
      if (mode === 'reception') {
        const commande = await apiPost<Commande>('/api/commandes/scan-reception', {
          ...corpsDuCode(code),
          ...(besoinHubExplicite ? { hubId: hubChoisiId } : {}),
        });
        noter({
          ton: 'ok',
          texte: `${commande.codeSuivi} — ${commande.clientNom} reçu au hub${hubLibelle ? ` ${hubLibelle}` : ''}.`,
          commande,
        });
      } else {
        const res = await apiPost<{ commande: Commande; dejaScanne: boolean }>(
          `/api/bons-distribution/${tourneeId}/scan-retour`,
          corpsDuCode(code)
        );
        noter({
          ton: res.dejaScanne ? 'info' : 'ok',
          texte: res.dejaScanne
            ? `${res.commande.codeSuivi} déjà enregistré au retour.`
            : `${res.commande.codeSuivi} — ${res.commande.clientNom} rentré au dépôt.`,
          commande: res.commande,
        });
      }
    } catch (err) {
      noter({ ton: 'erreur', texte: err instanceof Error ? err.message : 'Erreur de scan' });
    } finally {
      setEnCours(false);
    }
  }

  const nbReussis = journal.filter((e) => e.ton === 'ok').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ScanLine className="h-6 w-6 text-brand-ink dark:text-brand" />
            Poste de scan
          </h1>
          <p className="flex items-center gap-1.5 text-sm opacity-70">
            <Building2 className="h-3.5 w-3.5" />
            {hubLibelle ? `Hub ${hubLibelle}` : 'Hub à sélectionner'}
          </p>
        </div>
        <Link href="/planner/bons-distribution" className="btn-outline flex items-center gap-1.5">
          <Share2 className="h-4 w-4" />
          Bons de distribution
        </Link>
      </div>

      {/* Choix du geste : réception au quai ou déchargement au retour. */}
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => {
          const Icone = m.icone;
          return (
            <button
              key={m.cle}
              type="button"
              onClick={() => setMode(m.cle)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                mode === m.cle
                  ? 'bg-brand text-brand-ink'
                  : 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20'
              }`}
            >
              <Icone className="h-4 w-4" />
              {m.label}
            </button>
          );
        })}
      </div>

      <section className="card-tint-strong flex flex-col gap-4 p-5">
        <p className="text-xs opacity-70">{modeCourant.aide}</p>

        {mode === 'reception' && besoinHubExplicite && (
          <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
            Hub de réception
            <select className="input-basic" value={hubChoisiId} onChange={(e) => setHubChoisiId(e.target.value)}>
              <option value="">Sélectionner un hub</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.nom}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === 'retour' && (
          <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
            Tournée rentrée
            <select className="input-basic" value={tourneeId} onChange={(e) => setTourneeId(e.target.value)}>
              <option value="">Sélectionner une tournée ouverte</option>
              {tournees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.numero} — {t.livreur?.nomComplet ?? '—'} ({t.nbColis} colis)
                </option>
              ))}
            </select>
          </label>
        )}

        {bloquant ? (
          <p className="text-sm font-semibold text-orange-600">{bloquant}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCameraActive((v) => !v)}
              className="btn-outline flex w-fit items-center gap-1.5"
            >
              <ScanLine className="h-4 w-4" />
              {cameraActive ? 'Fermer la caméra' : 'Ouvrir la caméra'}
            </button>
            {/* <QrScanner /> embarque déjà la saisie manuelle de secours
                (douchette ou clavier), affichée tant que la caméra n'est pas
                active — inutile de dupliquer un second champ ici. */}
            <QrScanner active={cameraActive} disabled={enCours} onScan={(raw) => scanner(raw)} />
          </>
        )}

        {mode === 'retour' && tourneeId && (
          <Link
            href={`/planner/bons-distribution/${tourneeId}/cloture`}
            className="text-xs font-semibold hover:underline"
          >
            Passer à la clôture de cette tournée (caisse & gains) →
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center justify-between gap-2 text-sm font-bold">
          <span>Scans de la session</span>
          <span className="text-xs font-semibold opacity-60">
            {nbReussis} enregistré{nbReussis > 1 ? 's' : ''} / {journal.length} scan{journal.length > 1 ? 's' : ''}
          </span>
        </h2>
        {journal.length === 0 ? (
          <p className="text-sm opacity-60">Aucun scan pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {journal.map((e) => (
              <li
                key={e.cle}
                className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  e.ton === 'erreur'
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : e.ton === 'info'
                      ? 'bg-black/5 dark:bg-white/10'
                      : 'bg-green-500/10 text-green-800 dark:text-green-400'
                }`}
              >
                <span className="font-mono text-xs opacity-60">{e.heure}</span>
                <span className="flex-1 font-medium">{e.texte}</span>
                {e.commande && <StatutBadge statut={e.commande.statut} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
