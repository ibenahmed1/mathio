'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonRetour, Commande, HubRetour, RamasseurDisponible } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';
import BonDistributionCreerUI from '@/components/admin/BonDistributionCreerUI';

// § Composition d'un Bon de Retour (§ /admin/bon-retour/**).
//
// Même wizard que le Bon de Distribution — c'est le même geste sur le quai,
// mené par la même personne : on choisit une zone, un acteur, puis on remplit
// un panier au scan. Deux différences, et deux seulement :
//   - l'acteur de l'étape 2 est un RAMASSEUR et non un livreur (il rapporte
//     les colis au marchand au lieu de les emmener au client) ;
//   - la matière de l'étape 3 est le stock RESTITUABLE et non le stock à
//     livrer (colis en échec définitif présents au hub).
// Le composant présentationnel est strictement le même
// (<BonDistributionCreerUI />), piloté par sa table `libelles`.
//
// La règle « un bon = un marchand » est ce qui distingue vraiment ce panier de
// celui de la distribution : le marchand n'est jamais choisi, il se FIGE au
// premier colis ajouté, et le vivier se restreint aussitôt à sa boutique.
// Filtrer plutôt que griser est délibéré — sur un quai, une liste qui ne
// propose que ce qu'on peut prendre vaut mieux qu'une liste où l'on cherche ce
// qui n'est pas barré.

/** Axe des puces de filtre de l'étape 3 — les trois entrées de la navigation
 *  admin ne changent QUE cela : par livreur quand on vide un véhicule, par
 *  marchand quand on prépare une restitution annoncée. Le document produit est
 *  identique dans les trois cas. */
export type AxeFiltre = 'marchand' | 'livreur';

interface EntreeJournal {
  id: string;
  heure: string;
  texte: string;
}

const PAGE_SIZE_COLIS = 25;

function initiales(nom: string) {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDh(value: number) {
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DH`;
}

function heureCourante() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function BonRetourCreer({ axe = 'marchand' }: { axe?: AxeFiltre }) {
  const router = useRouter();

  const [etape, setEtape] = useState<'zone' | 'bon'>('zone');
  const [hubs, setHubs] = useState<HubRetour[]>([]);
  const [hubId, setHubId] = useState('');

  const [ramasseurs, setRamasseurs] = useState<RamasseurDisponible[]>([]);
  const [ramasseurId, setRamasseurId] = useState('');
  const [rechercheRamasseur, setRechercheRamasseur] = useState('');

  const [eligibles, setEligibles] = useState<Commande[]>([]);
  const [rechercheColis, setRechercheColis] = useState('');
  const [filtreId, setFiltreId] = useState<string | null>(null);
  const [limiteAffichage, setLimiteAffichage] = useState(PAGE_SIZE_COLIS);

  const [panier, setPanier] = useState<Commande[]>([]);

  const [scanValue, setScanValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [journal, setJournal] = useState<EntreeJournal[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  const [creating, setCreating] = useState(false);
  const [codeBR, setCodeBR] = useState<string | null>(null);
  const [statutLabel, setStatutLabel] = useState('Nouveau');
  const [error, setError] = useState<string | null>(null);

  // Le Planner ne reçoit qu'un hub (la route le confine côté serveur) :
  // l'étape 1 n'aurait qu'une carte à cliquer, autant la franchir pour lui.
  useEffect(() => {
    apiGet<{ data: HubRetour[] }>('/api/bons-retour/zones')
      .then((res) => {
        setHubs(res.data);
        if (res.data.length === 1) {
          setHubId(res.data[0].id);
          setEtape('bon');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  // Les ramasseurs ne dépendent pas du hub — ils ne sont rattachés à aucun
  // (cf. GET /api/bons-retour/ramasseurs). Un seul chargement suffit.
  useEffect(() => {
    apiGet<{ data: RamasseurDisponible[] }>('/api/bons-retour/ramasseurs')
      .then((res) => setRamasseurs(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (!hubId) {
        setEligibles([]);
        return;
      }
      apiGet<{ colis: Commande[] }>(`/api/bons-retour/colis-eligibles?hubId=${encodeURIComponent(hubId)}`)
        .then((res) => setEligibles(res.colis))
        .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
    });
  }, [hubId]);

  const hubSelectionne = hubs.find((h) => h.id === hubId) ?? null;
  const ramasseurSelectionne = ramasseurs.find((r) => r.id === ramasseurId) ?? null;

  const marchandDuBon = panier[0]?.marchandId ?? null;
  const boutiqueDuBon = panier[0]?.marchand?.nomBoutique ?? null;

  const panierIds = useMemo(() => new Set(panier.map((c) => c.id)), [panier]);

  // Vivier : ce qui n'est pas déjà au panier et, dès le premier colis ajouté,
  // ce qui appartient au même marchand que lui.
  const poolDisponible = useMemo(
    () =>
      eligibles.filter(
        (c) => !panierIds.has(c.id) && (!marchandDuBon || c.marchandId === marchandDuBon)
      ),
    [eligibles, panierIds, marchandDuBon]
  );

  const ramasseursFiltres = useMemo(() => {
    const q = rechercheRamasseur.trim().toLowerCase();
    if (!q) return ramasseurs;
    return ramasseurs.filter(
      (r) => r.nomComplet.toLowerCase().includes(q) || (r.telephone ?? '').toLowerCase().includes(q)
    );
  }, [ramasseurs, rechercheRamasseur]);

  // Puces de filtre : « Tous » + une puce par marchand (ou par livreur qui a
  // rapporté le colis, selon l'entrée de navigation), avec compteur.
  const filtres = useMemo(() => {
    const groupes = new Map<string, { label: string; n: number }>();
    for (const c of poolDisponible) {
      const id = axe === 'livreur' ? c.livreurId ?? 'sans' : c.marchandId;
      const label =
        axe === 'livreur' ? c.livreur?.nomComplet ?? 'Sans livreur' : c.marchand?.nomBoutique ?? '—';
      const existant = groupes.get(id) ?? { label, n: 0 };
      existant.n += 1;
      groupes.set(id, existant);
    }
    const tries = [...groupes.entries()].sort((a, b) => b[1].n - a[1].n);
    return [
      { id: 'tous', label: `Tous (${poolDisponible.length})`, actif: filtreId === null },
      ...tries.map(([id, g]) => ({ id, label: `${g.label} (${g.n})`, actif: filtreId === id })),
    ];
  }, [poolDisponible, filtreId, axe]);

  const poolFiltre = useMemo(() => {
    let liste = poolDisponible;
    if (filtreId) {
      liste = liste.filter((c) =>
        axe === 'livreur' ? (c.livreurId ?? 'sans') === filtreId : c.marchandId === filtreId
      );
    }
    const q = rechercheColis.trim().toLowerCase();
    if (q) {
      liste = liste.filter(
        (c) =>
          c.codeSuivi.toLowerCase().includes(q) ||
          c.clientNom.toLowerCase().includes(q) ||
          (c.marchand?.nomBoutique ?? '').toLowerCase().includes(q)
      );
    }
    return liste;
  }, [poolDisponible, filtreId, rechercheColis, axe]);

  const poolAffiche = poolFiltre.slice(0, limiteAffichage);
  const resteAAfficher = Math.max(0, poolFiltre.length - poolAffiche.length);

  const totalCod = panier.reduce((s, c) => s + Number(c.montantCod), 0);

  function noterJournal(texte: string) {
    setJournal((prev) =>
      [{ id: `${prev.length}-${texte}-${prev[0]?.id ?? 'init'}`, heure: heureCourante(), texte }, ...prev].slice(0, 50)
    );
  }

  function resetApresHub() {
    setRamasseurId('');
    setRechercheRamasseur('');
    setEligibles([]);
    setRechercheColis('');
    setFiltreId(null);
    setLimiteAffichage(PAGE_SIZE_COLIS);
    setPanier([]);
    setScanValue('');
    setCameraActive(false);
    setJournal([]);
    setMessage(null);
  }

  function handleZonePick(id: string) {
    setHubId(id);
    resetApresHub();
    setEtape('bon');
  }

  function handleZoneChange() {
    setHubId('');
    resetApresHub();
    setEtape('zone');
  }

  function handleRamasseurPick(id: string) {
    setRamasseurId((prev) => (prev === id ? '' : id));
    setPanier([]);
    setRechercheColis('');
    setFiltreId(null);
    setLimiteAffichage(PAGE_SIZE_COLIS);
    setCameraActive(false);
    setJournal([]);
    setMessage(null);
  }

  // Le filtre courant est relâché à chaque ajout : une fois le marchand figé,
  // il peut désigner un groupe qui n'existe plus dans le vivier restreint, et
  // la liste paraîtrait vide sans raison visible.
  function ajouterColis(c: Commande) {
    setPanier((prev) => {
      if (prev.some((x) => x.id === c.id)) return prev;
      if (prev.length > 0 && prev[0].marchandId !== c.marchandId) return prev;
      return [...prev, c];
    });
    setFiltreId(null);
  }

  function handleColisAdd(id: string) {
    const c = eligibles.find((x) => x.id === id);
    if (!c) return;
    if (marchandDuBon && c.marchandId !== marchandDuBon) {
      const texte = `${c.codeSuivi} appartient à ${c.marchand?.nomBoutique ?? 'un autre marchand'} — ce bon est destiné à ${boutiqueDuBon}. Créez un bon séparé.`;
      setMessage(texte);
      noterJournal(texte);
      return;
    }
    ajouterColis(c);
  }

  function handleColisRemove(id: string) {
    setPanier((prev) => prev.filter((c) => c.id !== id));
  }

  function handleDropColis(id: string, index: number | null) {
    const c = eligibles.find((x) => x.id === id);
    if (!c || panierIds.has(c.id)) return;
    if (marchandDuBon && c.marchandId !== marchandDuBon) {
      handleColisAdd(id);
      return;
    }
    setPanier((prev) => {
      const next = [...prev];
      next.splice(index ?? next.length, 0, c);
      return next;
    });
    setFiltreId(null);
  }

  function handleReorder(id: string, index: number) {
    setPanier((prev) => {
      const current = prev.findIndex((c) => c.id === id);
      if (current === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(current, 1);
      const cible = current < index ? index - 1 : index;
      next.splice(Math.max(0, Math.min(next.length, cible)), 0, item);
      return next;
    });
  }

  // « Ajouter tout le filtre » ne peut embarquer qu'un seul marchand : si le
  // panier est encore vide, on prend celui du premier colis de la sélection et
  // on écarte le reste, plutôt que de composer un lot mélangé que l'API
  // refusera au dernier moment.
  function handleAjouterFiltre() {
    if (poolFiltre.length === 0) return;
    const marchandCible = marchandDuBon ?? poolFiltre[0].marchandId;
    const retenus = poolFiltre.filter((c) => c.marchandId === marchandCible);
    const ecartes = poolFiltre.length - retenus.length;
    setPanier((prev) => {
      const ids = new Set(prev.map((c) => c.id));
      return [...prev, ...retenus.filter((c) => !ids.has(c.id))];
    });
    setFiltreId(null);
    if (ecartes > 0) {
      const texte = `${retenus.length} colis ajoutés ; ${ecartes} écartés car d'un autre marchand — un bon de retour ne concerne qu'une boutique.`;
      setMessage(texte);
      noterJournal(texte);
    }
  }

  // Chemin unique du scan (douchette/clavier via le champ du wizard, caméra
  // via <QrScanner />) : un payload QR signé contient un point, un code de
  // suivi n'en contient jamais — même heuristique que le bon de distribution.
  //
  // La cohérence du marchand est tranchée par le SERVEUR (marchandAttendu),
  // pas ici : c'est la même règle qu'à la création, donc aucun écart possible
  // entre ce que le Planner voit et ce qui sera accepté.
  async function scannerCode(raw: string) {
    const code = raw.trim();
    if (!code || scanning || !hubId || !ramasseurId) return;
    setScanning(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        hubId,
        ...(marchandDuBon ? { marchandAttendu: marchandDuBon } : {}),
        ...(code.includes('.') ? { qrPayload: code } : { codeSuivi: code }),
      };
      const commande = await apiPost<Commande>('/api/bons-retour/scan', body);
      const dejaDansLeBon = panier.some((c) => c.id === commande.id);
      ajouterColis(commande);
      const texte = dejaDansLeBon
        ? `Colis ${commande.codeSuivi} déjà dans le bon.`
        : `Colis ${commande.codeSuivi} — ${commande.clientNom} ajouté au bon.`;
      setMessage(texte);
      noterJournal(texte);
      setScanValue('');
    } catch (err) {
      const texte = err instanceof Error ? err.message : 'Erreur de scan';
      setMessage(texte);
      noterJournal(texte);
    } finally {
      setScanning(false);
    }
  }

  // La boucle de détection de <QrScanner /> vit hors du cycle de rendu React :
  // elle doit appeler la dernière version de `scannerCode` (celle qui connaît
  // le hub, le ramasseur et le panier courants), jamais celle capturée au
  // montage de la caméra.
  const scannerCodeRef = useRef(scannerCode);
  useEffect(() => {
    scannerCodeRef.current = scannerCode;
  });

  function handleReset() {
    setHubId('');
    resetApresHub();
    setEtape('zone');
    setCodeBR(null);
    setStatutLabel('Nouveau');
    setError(null);
  }

  function handleValider() {
    if (panier.length === 0) return;
    setConfirmationOuverte(true);
  }

  async function handleConfirmer() {
    if (!hubId || !ramasseurId || panier.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiPost<BonRetour>('/api/bons-retour', {
        hubId,
        ramasseurId,
        colisIds: panier.map((c) => c.id),
      });
      setCodeBR(created.numero);
      setStatutLabel('En cours');
      setConfirmationOuverte(false);
      setCameraActive(false);
      // La vue d'impression est le document que le ramasseur emporte et fait
      // signer : c'est bien elle que « Valider & imprimer » doit ouvrir.
      router.push(`/bons-retour/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setConfirmationOuverte(false);
    } finally {
      setCreating(false);
    }
  }

  const scanCameraDisponible = etape === 'bon' && Boolean(hubId) && Boolean(ramasseurId);

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="px-1 text-sm font-medium text-red-600">{error}</p>}

      {scanCameraDisponible && (
        <section className="card-tint-strong flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <ScanLine className="h-4 w-4" />
                Scanner les colis à restituer
              </h2>
              <p className="text-xs opacity-60">
                Chargement du véhicule de {ramasseurSelectionne?.nomComplet ?? 'ce ramasseur'} — chaque colis scanné
                rejoint le bon, et le premier fixe la boutique destinataire. Le champ « CLIC ICI AVANT LE SCAN » du
                panneau reste disponible pour la douchette.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCameraActive((v) => !v)}
              className="btn-outline flex shrink-0 items-center gap-1.5"
            >
              <ScanLine className="h-4 w-4" />
              {cameraActive ? 'Fermer la caméra' : 'Ouvrir la caméra'}
            </button>
          </div>

          {cameraActive && (
            <QrScanner active={cameraActive} disabled={scanning} onScan={(raw) => scannerCodeRef.current(raw)} />
          )}
        </section>
      )}

      <BonDistributionCreerUI
        libelles={{
          kicker: 'BONS DE RETOUR · CRÉER',
          etape1: 'ÉTAPE 1 · ZONE DE RETOUR',
          etape1Aide: 'Choisissez le hub où sont les colis à rendre.',
          zoneSousLigne: 'ramasseurs actifs',
          zoneMetrique: 'À RESTITUER',
          etape2: 'ÉTAPE 2 · RAMASSEUR',
          etape2Vide: 'Aucun ramasseur actif.',
          acteurMetrique: 'EN COURS',
          choisirActeur: 'Choisissez un ramasseur pour',
          choisirActeurAide: "La liste des colis à restituer s'affichera ici.",
          etape3: 'ÉTAPE 3 · COLIS À RESTITUER',
          etape3Placeholder: 'Code, client, boutique…',
          colisVide: 'Aucun colis à restituer.',
          bonVideTitre: 'Glissez ou scannez les colis à rendre',
          bonVideAide: "Le premier colis fixe la boutique : un bon de retour ne concerne qu'un marchand.",
          validation: 'VALIDATION DU BON DE RETOUR',
        }}
        codeBD={codeBR}
        statutLabel={statutLabel}
        statutTone={statutLabel === 'En cours' ? 'ok' : 'warn'}
        etape={etape === 'zone' ? 'zone' : 'tournee'}
        zones={hubs.map((h) => {
          const maxColis = Math.max(1, ...hubs.map((hh) => hh.nbColisRestituables));
          return {
            id: h.id,
            nom: h.nom,
            nbColis: h.nbColisRestituables,
            nbLivreurs: h.nbRamasseursActifs,
            ratio: h.nbColisRestituables / maxColis,
          };
        })}
        zone={hubSelectionne ? { nom: hubSelectionne.nom } : null}
        livreurs={ramasseursFiltres.map((r) => ({
          id: r.id,
          nom: r.nomComplet,
          initiales: initiales(r.nomComplet),
          ligneSecondaire: r.telephone ?? '',
          compteur: String(r.bonsEnCours),
          selected: r.id === ramasseurId,
        }))}
        livreurCompteur={`${ramasseursFiltres.length}/${ramasseurs.length}`}
        rechercheLivreur={rechercheRamasseur}
        livreurNom={ramasseurSelectionne?.nomComplet ?? ''}
        bonSousTitre={
          boutiqueDuBon ? `Destinataire : ${boutiqueDuBon} — seuls ses colis restent proposés.` : null
        }
        colis={poolAffiche.map((c) => ({
          id: c.id,
          code: c.codeSuivi,
          client: c.clientNom,
          ville: c.ville,
          quartier: c.marchand?.nomBoutique ?? '',
          crbt: formatDh(Number(c.montantCod)),
        }))}
        colisCompteur={`${poolAffiche.length} / ${poolFiltre.length}`}
        rechercheColis={rechercheColis}
        filtres={filtres}
        resteAAfficher={resteAAfficher}
        bon={panier.map((c) => ({
          id: c.id,
          code: c.codeSuivi,
          ligneSecondaire: `${c.clientNom} — ${c.ville}`,
          crbt: formatDh(Number(c.montantCod)),
        }))}
        totaux={[
          { label: 'COLIS', value: String(panier.length) },
          { label: 'VALEUR COD', value: formatDh(totalCod) },
          { label: 'BOUTIQUE', value: boutiqueDuBon ?? '—' },
        ]}
        scanValue={scanValue}
        scanVisible
        message={message}
        journal={journal}
        confirmation={
          confirmationOuverte
            ? {
                ouverte: true,
                titre: 'Confirmer le Bon de Retour',
                sousTitre: `${boutiqueDuBon ?? ''} — ${ramasseurSelectionne?.nomComplet ?? ''}`,
                totaux: [
                  { label: 'COLIS', value: String(panier.length) },
                  { label: 'VALEUR COD', value: formatDh(totalCod) },
                ],
                texte: creating
                  ? 'Création en cours…'
                  : "Les colis seront réservés sur ce bon et confiés au ramasseur. Ils ne passeront « Retourné » qu'au moment où il les remettra en main propre au marchand.",
              }
            : null
        }
        onZonePick={handleZonePick}
        onZoneChange={handleZoneChange}
        onLivreurPick={handleRamasseurPick}
        onRechercheLivreur={setRechercheRamasseur}
        onRechercheColis={setRechercheColis}
        onFiltrePick={(id: string) => setFiltreId(id === 'tous' ? null : id)}
        onColisAdd={handleColisAdd}
        onColisRemove={handleColisRemove}
        onAfficherPlus={() => setLimiteAffichage((n) => n + PAGE_SIZE_COLIS)}
        onAjouterFiltre={handleAjouterFiltre}
        onDropColis={handleDropColis}
        onReorder={handleReorder}
        onScanChange={setScanValue}
        onScanSubmit={() => scannerCode(scanValue)}
        onValider={handleValider}
        onReset={handleReset}
        onConfirmer={handleConfirmer}
        onAnnuler={() => setConfirmationOuverte(false)}
      />
    </div>
  );
}
