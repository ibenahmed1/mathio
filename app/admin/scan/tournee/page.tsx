'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, PackageCheck, ScanLine, Share2, Undo2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
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

interface BonResolu {
  id: string;
  numero: string;
  statut: string;
  hub: { nom: string };
}

interface Resolution {
  commande: { id: string; codeSuivi: string; clientNom: string; ville: string; statut: string };
  action: 'reception' | 'retour' | 'aucune';
  bon: BonResolu | null;
  raison?: string;
}

interface EntreeJournal {
  cle: string;
  heure: string;
  ton: 'ok' | 'info' | 'erreur';
  texte: string;
  commande?: Commande;
}

function heureCourante() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// § /admin/scan/tournee — poste de scan du Planner sur le quai.
//
// À ne pas confondre avec § /admin/scan/reception, le poste de l'Agent Hub :
// celui-ci couvre les DEUX gestes du quai dans un seul écran (réception d'un
// dépôt ET retour de tournée), parce que le Planner a les deux dans les mains
// au même moment.
//
// UN SEUL GESTE. Le Planner scanne, le serveur décide quoi faire du colis à
// partir de son état réel (POST /api/bons-distribution/resoudre-scan), puis la
// page appelle l'endpoint correspondant :
//   • colis déposé au quai ("ramasse"/"en_transit")  -> réception au hub
//   • colis d'une tournée ouverte, non livré          -> retour de tournée
//
// Une version antérieure de cet écran demandait au Planner de choisir le mode
// AVANT de scanner. C'était lui demander de deviner l'état d'un colis qu'il a
// simplement dans la main : scanner un retour de tournée alors que le mode
// "Réception au hub" était actif renvoyait « seul un colis ramasse ou
// en_transit peut être réceptionné au hub », sans indiquer le bon geste. Les
// deux cas étant disjoints par construction, c'est au serveur de trancher.
export default function ScanTourneePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [journal, setJournal] = useState<EntreeJournal[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  // Réception : un planner scanne toujours pour son propre hub (résolu côté
  // serveur) ; un admin sans hub de rattachement doit en choisir un.
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [hubChoisiId, setHubChoisiId] = useState('');

  useEffect(() => {
    apiGet<MeResponse>('/api/auth/me')
      .then(setMe)
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

  // Seul l'admin sans hub doit choisir : il ne peut pas réceptionner "au nom"
  // d'un hub que le serveur ne peut pas déduire de son compte.
  const bloquant =
    besoinHubExplicite && !hubChoisiId ? 'Choisissez le hub sur lequel vous travaillez avant de scanner.' : null;

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
      const corps = corpsDuCode(code);
      const resolution = await apiPost<Resolution>('/api/bons-distribution/resoudre-scan', corps);

      if (resolution.action === 'aucune') {
        noter({ ton: 'erreur', texte: `${resolution.commande.codeSuivi} — ${resolution.raison}` });
        return;
      }

      if (resolution.action === 'reception') {
        const commande = await apiPost<Commande>('/api/commandes/scan-reception', {
          ...corps,
          ...(besoinHubExplicite ? { hubId: hubChoisiId } : {}),
        });
        noter({
          ton: 'ok',
          texte: `${commande.codeSuivi} — ${commande.clientNom} reçu au hub${hubLibelle ? ` ${hubLibelle}` : ''}.`,
          commande,
        });
        return;
      }

      // Retour de tournée : la tournée vient de la résolution, le Planner n'a
      // pas à la désigner — un colis ne peut rentrer que dans celle qui l'a
      // emporté, et c'est déjà revérifié côté serveur.
      const bonId = resolution.bon!.id;
      const res = await apiPost<{ commande: Commande; dejaScanne: boolean; parDerogation: boolean }>(
        `/api/bons-distribution/${bonId}/scan-retour`,
        corps
      );
      noter({
        ton: res.dejaScanne ? 'info' : 'ok',
        texte: res.dejaScanne
          ? `${res.commande.codeSuivi} déjà enregistré au retour de la tournée ${resolution.bon!.numero}.`
          : res.parDerogation
            ? `${res.commande.codeSuivi} — ${res.commande.clientNom} réintégré par dérogation (non qualifié par le livreur), tournée ${resolution.bon!.numero}.`
            : `${res.commande.codeSuivi} — ${res.commande.clientNom} rentré au dépôt, tournée ${resolution.bon!.numero}.`,
        commande: res.commande,
      });
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
        <Link href="/admin/bon-distribution" className="btn-outline flex items-center gap-1.5">
          <Share2 className="h-4 w-4" />
          Bons de distribution
        </Link>
      </div>

      <section className="card-tint-strong flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2 text-xs">
          <p className="font-semibold opacity-80">
            Scannez n&apos;importe quel colis : le geste est déduit de son état, vous n&apos;avez rien à choisir.
          </p>
          <ul className="flex flex-col gap-1 opacity-70">
            <li className="flex items-start gap-1.5">
              <PackageCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Colis déposé au quai par un ramasseur ou arrivé en transit → <strong>reçu au hub</strong>, il devient
              éligible à une prochaine tournée.
            </li>
            <li className="flex items-start gap-1.5">
              <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Colis non livré ramené par le livreur → <strong>retourné au Hub</strong>, sans écraser le motif terrain.
              Un colis que le livreur n&apos;a pas qualifié est réintégré par dérogation Planner/Admin, et tracé comme
              tel. Un colis livré est refusé.
            </li>
          </ul>
        </div>

        {besoinHubExplicite && (
          <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
            Hub de travail
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
                {e.commande && <StatutBadge statut={e.commande.statut} hubVille={e.commande.hubActuel?.ville} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
