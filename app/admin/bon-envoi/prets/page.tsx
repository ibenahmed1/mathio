'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, ScanLine, Send, TriangleAlert } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { ColisEligibleDto } from '@/lib/bon-envoi-prestataire';
import { QrScanner } from '@/components/QrScanner';
import { lireDouchette } from '@/lib/douchette';
import { StatusPill, P } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';
import { CodeColis } from '@/components/colis/CodeColis';
import { annoncerEchec, annoncerSucces } from '@/lib/annonces';

// § Colis prêts à envoyer (13/10/2026) — l'entrée du bon d'envoi par
// transporteur, dans la composition du tableau de bord admin (fond, cadrans,
// cartes et boutons de l'Accueil). Une carte par transporteur avec, en
// pastille rouge, le nombre de colis que sa ville lui destine ; on ouvre la
// carte, on coche ou on scanne ses colis, on envoie : le bon d'envoi est créé
// (POST /api/bons-envoi) et visible dans Documents de transport › Bon d'envoi.

interface TransporteurPret {
  id: string;
  nom: string;
  nbColis: number;
}

type Message = { ok: boolean; texte: string; bon?: { id: string; numero: string } } | null;

// Dégradés de la palette du tableau de bord, attribués aux transporteurs dans
// l'ordre alphabétique (stable d'une visite à l'autre).
const DEGRADES: [string, string][] = [
  ['#8ECAE6', '#209EBB'],
  ['#209EBB', '#023047'],
  ['#FFE14D', '#FFB701'],
  ['#FFB701', '#FC8500'],
  ['#023047', '#4A4A45'],
  ['#14526E', '#209EBB'],
  ['#FC8500', '#E56A00'],
];

function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
}

export default function ColisPretsAEnvoyerPage() {
  const [transporteurs, setTransporteurs] = useState<TransporteurPret[]>([]);
  const [sansTransporteur, setSansTransporteur] = useState(0);
  const [bonsARemettre, setBonsARemettre] = useState<number | null>(null);
  const [choisi, setChoisi] = useState<TransporteurPret | null>(null);
  const [colis, setColis] = useState<ColisEligibleDto[]>([]);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<Message>(null);

  const chargerCartes = useCallback(async () => {
    const [res, compteurs] = await Promise.all([
      apiGet<{ transporteurs: TransporteurPret[]; sansTransporteur: number }>('/api/bons-envoi/prets'),
      apiGet<{ bon_envoi?: number }>('/api/compteurs').catch(() => ({}) as { bon_envoi?: number }),
    ]);
    setTransporteurs(res.transporteurs);
    setSansTransporteur(res.sansTransporteur);
    setBonsARemettre(compteurs.bon_envoi ?? null);
    return res.transporteurs;
  }, []);

  useEffect(() => {
    Promise.resolve()
      .then(() => chargerCartes())
      .catch((e) => setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Erreur' }))
      .finally(() => setChargement(false));
  }, [chargerCartes]);

  async function ouvrir(t: TransporteurPret) {
    setChoisi(t);
    setCoches(new Set());
    setMessage(null);
    const res = await apiGet<{ data: ColisEligibleDto[] }>(`/api/bons-envoi/colis-eligibles?prestataireId=${t.id}`);
    // Seuls les colis que sa ville destine à CE transporteur : les autres
    // seraient refusés à l'envoi.
    setColis(res.data.filter((c) => c.transporteursVille[0]?.id === t.id));
  }

  function basculer(id: string) {
    setCoches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Scan (douchette, caméra ou saisie) : coche le colis s'il est dans la liste.
  async function scanner(brut: string) {
    if (!choisi || !brut) return;
    try {
      const corps = brut.includes('.') ? { qrPayload: brut } : { codeSuivi: brut.toUpperCase() };
      const trouve = await apiPost<{ id: string; codeSuivi: string }>('/api/bons-envoi/verifier-colis', {
        prestataireId: choisi.id,
        ...corps,
      });
      if (!colis.some((c) => c.id === trouve.id)) {
        setMessage({ ok: false, texte: `${trouve.codeSuivi} n'est pas dans la liste de ${choisi.nom}` });
        annoncerEchec(`${trouve.codeSuivi} n'est pas dans la liste de ${choisi.nom}`, { son: true });
        return;
      }
      setCoches((prev) => new Set(prev).add(trouve.id));
      setMessage({ ok: true, texte: `${trouve.codeSuivi} ajouté` });
      annoncerSucces(`${trouve.codeSuivi} ajouté au bon`, { son: true });
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Erreur de scan' });
      annoncerEchec(e, { son: true, prefixe: `Scan ${brut}` });
    } finally {
      setCode('');
    }
  }

  async function envoyer() {
    if (!choisi || coches.size === 0) return;
    setEnvoi(true);
    setMessage(null);
    try {
      const bon = await apiPost<{ id: string; numero: string; nbColis: number }>('/api/bons-envoi', {
        prestataireId: choisi.id,
        colisIds: Array.from(coches),
      });
      // Les envoyés quittent la liste et les compteurs (cartes et barre latérale).
      window.dispatchEvent(new Event('compteurs:maj'));
      const maj = await chargerCartes();
      await ouvrir(maj.find((x) => x.id === choisi.id) ?? choisi);
      setMessage({ ok: true, texte: `Bon d'envoi ${bon.numero} généré : ${bon.nbColis} colis pour ${choisi.nom}`, bon });
      annoncerSucces(`Bon d'envoi ${bon.numero} généré : ${bon.nbColis} colis pour ${choisi.nom}. Étape suivante : le transmettre.`);
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Erreur' });
      annoncerEchec(e, { prefixe: "Création du bon d'envoi" });
    } finally {
      setEnvoi(false);
    }
  }

  const total = transporteurs.reduce((n, t) => n + t.nbColis, 0);
  const actifs = transporteurs.filter((t) => t.nbColis > 0).length;
  const max = Math.max(1, ...transporteurs.map((t) => t.nbColis));
  const degradeDe = (id: string) => DEGRADES[Math.max(0, transporteurs.findIndex((t) => t.id === id)) % DEGRADES.length];
  const tousCoches = colis.length > 0 && colis.every((c) => coches.has(c.id));
  const totalCod = colis.filter((c) => coches.has(c.id)).reduce((n, c) => n + c.montantCod, 0);

  return (
    <main className={s.main}>
      <header className={s.entete}>
        <h1 className={s.titre}>Colis prêts à envoyer</h1>
        <Link href="/admin/bon-envoi" className={s.btnNavy}>
          <Send className="h-4 w-4" /> Voir les bons d&apos;envoi
        </Link>
      </header>

      {/* ===== Cadrans (ceux de l'Accueil) ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span className={s.kpiLabel}>Colis prêts</span>
          <span className={s.kpiValeur}>{total}</span>
          <span className={s.kpiNote}>À confier à un transporteur</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span className={s.kpiLabel} style={{ color: P.jaune }}>Transporteurs concernés</span>
          <span className={s.kpiValeur}>
            {actifs}
            <span style={{ fontSize: 14, opacity: 0.6 }}> / {transporteurs.length}</span>
          </span>
          <span className={s.kpiNote}>Ont des colis qui attendent</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
          <span className={s.kpiLabel}>Bons à remettre</span>
          <span className={s.kpiValeur}>{bonsARemettre ?? '—'}</span>
          <span className={s.kpiNote}>Bons d&apos;envoi pas encore reçus</span>
        </div>
        <div
          className={s.kpi}
          style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}
        >
          <span className={s.kpiLabel}>Sans transporteur</span>
          <span className={s.kpiValeur}>{sansTransporteur}</span>
          <span className={s.kpiNote}>Ville desservie par personne</span>
        </div>
      </section>

      {sansTransporteur > 0 && (
        <div className={s.alerte}>
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {sansTransporteur} colis prêt{sansTransporteur > 1 ? 's' : ''} dont la ville n&apos;est desservie par aucun
          transporteur : corrigez leur ville pour qu&apos;ils apparaissent ici.
        </div>
      )}

      {message && (
        <div className={`${s.card} ${s.message} ${message.ok ? '' : s.messageErreur}`} role={message.ok ? 'status' : 'alert'}>
          <span className={s.messageTexte}>{message.texte}</span>
          {message.bon && (
            <Link href={`/admin/bon-envoi/${message.bon.id}`} className={s.btnNavy}>
              Consulter le bon {message.bon.numero}
            </Link>
          )}
        </div>
      )}

      {/* ===== Transporteurs ===== */}
      <h2 className={s.sectionTitre}>Transporteurs</h2>
      {chargement ? (
        <p style={{ fontSize: 13, color: '#8C8C86' }}>Chargement…</p>
      ) : (
        <section className={s.grille}>
          {transporteurs.map((t) => {
            const [a, b] = degradeDe(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => ouvrir(t)}
                className={`${s.card} ${s.transporteur} ${choisi?.id === t.id ? s.transporteurActif : ''} ${
                  t.nbColis === 0 ? s.transporteurVide : ''
                }`}
              >
                <span className={s.transporteurTete}>
                  <span className={s.avatar} style={{ background: `linear-gradient(135deg,${a},${b})` }}>
                    {initiales(t.nom)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className={s.nom}>{t.nom}</span>
                    <span className={s.nomSous}>{t.nbColis === 0 ? 'Rien à envoyer' : 'Prêt pour un bon d’envoi'}</span>
                  </span>
                </span>
                <span className={s.compte}>
                  <span className={s.compteValeur}>{t.nbColis}</span>
                  <span className={s.compteLibelle}>colis prêt{t.nbColis > 1 ? 's' : ''}</span>
                </span>
                <span className={s.barre}>
                  <span
                    className={s.barreRemplie}
                    style={{ display: 'block', width: `${(t.nbColis / max) * 100}%`, background: `linear-gradient(90deg,${a},${b})` }}
                  />
                </span>
                {t.nbColis > 0 && <span className={s.pastille}>{t.nbColis > 99 ? '99+' : t.nbColis}</span>}
              </button>
            );
          })}
        </section>
      )}

      {/* ===== Colis du transporteur choisi ===== */}
      {choisi && (
        <section className={`${s.card} ${s.panneau}`}>
          <div className={s.panneauTete}>
            <div className={s.transporteurTete}>
              <span className={s.avatar} style={{ background: `linear-gradient(135deg,${degradeDe(choisi.id)[0]},${degradeDe(choisi.id)[1]})` }}>
                {initiales(choisi.nom)}
              </span>
              <div>
                <h2 className={s.sectionTitre}>{choisi.nom}</h2>
                <span style={{ fontSize: 12, color: '#8C8C86' }}>
                  {colis.length} colis prêt{colis.length > 1 ? 's' : ''} · cochez ou scannez
                </span>
              </div>
            </div>
            <form
              className={s.scan}
              onSubmit={(e) => {
                e.preventDefault();
                const lecture = lireDouchette(code);
                if (lecture.etat === 'complet') scanner(lecture.code);
              }}
            >
              <input
                className={s.champ}
                value={code}
                onChange={(e) => {
                  // QR complet malgré l'Entrée prématuré de la douchette : envoyé tout de suite.
                  const lecture = lireDouchette(e.target.value);
                  if (lecture.etat === 'complet' && lecture.qr) scanner(lecture.code);
                  else setCode(e.target.value);
                }}
                placeholder="Scanner ou saisir PD-000000"
                autoComplete="off"
              />
              <button type="submit" className={s.btnClair} disabled={!code.trim()}>
                Ajouter
              </button>
              <button type="button" className={s.btnNavy} onClick={() => setCamera((v) => !v)}>
                <ScanLine className="h-4 w-4" /> {camera ? 'Fermer la caméra' : 'Caméra'}
              </button>
            </form>
          </div>

          {camera && <QrScanner active={camera} onScan={(raw) => scanner(raw.trim())} sansDouchette />}

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={tousCoches}
                      onChange={() => setCoches(tousCoches ? new Set() : new Set(colis.map((c) => c.id)))}
                      aria-label="Tout cocher"
                    />
                  </th>
                  <th>Code</th>
                  <th>Marchand</th>
                  <th>Destinataire</th>
                  <th>Ville</th>
                  <th>Hub de destination</th>
                  <th>COD</th>
                </tr>
              </thead>
              <tbody>
                {colis.map((c) => (
                  <tr key={c.id} className={coches.has(c.id) ? s.ligneCochee : ''} onClick={() => basculer(c.id)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={coches.has(c.id)} onChange={() => basculer(c.id)} aria-label={`Cocher ${c.codeSuivi}`} />
                    </td>
                    <td className={s.code}>
                      <CodeColis id={c.id} code={c.codeSuivi} />
                    </td>
                    <td>{c.marchandNom ?? '—'}</td>
                    <td>{c.clientNom}</td>
                    <td>{c.ville}</td>
                    <td>{c.hubPrevuNom ? <StatusPill label={c.hubPrevuNom} grad={degradeDe(choisi.id)} /> : '—'}</td>
                    <td className={s.cod}>{c.montantCod.toLocaleString('fr-FR')} DH</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {colis.length === 0 && (
              <div className={s.vide}>
                <PackageCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
                Aucun colis prêt pour {choisi.nom}
              </div>
            )}
          </div>

          <div className={s.pied}>
            <span className={s.piedTexte}>
              {coches.size > 0
                ? `${coches.size} colis sélectionné${coches.size > 1 ? 's' : ''} · ${totalCod.toLocaleString('fr-FR')} DH à encaisser`
                : 'Cochez ou scannez les colis à envoyer'}
            </span>
            <button type="button" className={s.btnJaune} disabled={envoi || coches.size === 0} onClick={envoyer}>
              <Send className="h-4 w-4" /> {envoi ? 'Envoi…' : `Envoyer à ${choisi.nom}`}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
