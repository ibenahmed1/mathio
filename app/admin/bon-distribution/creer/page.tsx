'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonDistribution, Commande, HubDistribution } from '@/lib/types';
import BonDistributionCreerUI from '@/components/admin/BonDistributionCreerUI';

interface LivreurEligible {
  id: string;
  nomComplet: string;
  telephone: string | null;
  nbColisEligibles: number;
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

// § Container de la création d'un Bon de Distribution (/admin/bon-distribution/creer) :
// gère tout l'état (hub → livreur → panier), appelle les endpoints
// /api/bons-distribution/** et passe le tout, sans logique métier côté
// composant, à <BonDistributionCreerUI /> (présentationnel pur, fourni tel
// quel — cf. components/admin/BonDistributionCreerUI.jsx). L'étape 1
// "Zone" du wizard fourni est alimentée par les Hub existants
// (§ /admin/hubs) — pas de référentiel géographique parallèle.
export default function CreerBonDistributionPage() {
  const router = useRouter();

  const [etape, setEtape] = useState<'zone' | 'tournee'>('zone');
  const [hubs, setHubs] = useState<HubDistribution[]>([]);
  const [hubId, setHubId] = useState('');

  const [livreurs, setLivreurs] = useState<LivreurEligible[]>([]);
  const [livreurId, setLivreurId] = useState('');
  const [rechercheLivreur, setRechercheLivreur] = useState('');

  const [eligibles, setEligibles] = useState<Commande[]>([]);
  const [rechercheColis, setRechercheColis] = useState('');
  const [filtreVille, setFiltreVille] = useState<string | null>(null);
  const [limiteAffichage, setLimiteAffichage] = useState(PAGE_SIZE_COLIS);

  const [bon, setBon] = useState<Commande[]>([]);

  const [scanValue, setScanValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  const [creating, setCreating] = useState(false);
  const [codeBD, setCodeBD] = useState<string | null>(null);
  const [statutLabel, setStatutLabel] = useState('Nouveau');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: HubDistribution[] }>('/api/bons-distribution/zones')
      .then((res) => setHubs(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  useEffect(() => {
    if (!hubId) {
      setLivreurs([]);
      return;
    }
    apiGet<{ data: LivreurEligible[] }>(`/api/bons-distribution/livreurs?hubId=${encodeURIComponent(hubId)}`)
      .then((res) => setLivreurs(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [hubId]);

  useEffect(() => {
    if (!hubId || !livreurId) {
      setEligibles([]);
      return;
    }
    apiGet<{ data: Commande[] }>(
      `/api/bons-distribution/colis-eligibles?hubId=${encodeURIComponent(hubId)}&livreurId=${encodeURIComponent(livreurId)}`
    )
      .then((res) => setEligibles(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [hubId, livreurId]);

  const hubSelectionne = hubs.find((h) => h.id === hubId) ?? null;
  const livreurSelectionne = livreurs.find((l) => l.id === livreurId) ?? null;

  const bonIds = useMemo(() => new Set(bon.map((c) => c.id)), [bon]);
  const poolDisponible = useMemo(() => eligibles.filter((c) => !bonIds.has(c.id)), [eligibles, bonIds]);

  const livreursFiltres = useMemo(() => {
    const q = rechercheLivreur.trim().toLowerCase();
    if (!q) return livreurs;
    return livreurs.filter(
      (l) => l.nomComplet.toLowerCase().includes(q) || (l.telephone ?? '').toLowerCase().includes(q)
    );
  }, [livreurs, rechercheLivreur]);

  // Puces de filtre : "Tous" + une puce par ville présente parmi les colis
  // éligibles, avec compteur — même esprit que la capture fournie.
  const filtres = useMemo(() => {
    const parVille = new Map<string, number>();
    for (const c of poolDisponible) parVille.set(c.ville, (parVille.get(c.ville) ?? 0) + 1);
    const villes = Array.from(parVille.entries()).sort((a, b) => b[1] - a[1]);
    return [
      { id: 'tous', label: `Tous (${poolDisponible.length})`, actif: filtreVille === null },
      ...villes.map(([ville, n]) => ({ id: ville, label: `${ville} (${n})`, actif: filtreVille === ville })),
    ];
  }, [poolDisponible, filtreVille]);

  const poolFiltre = useMemo(() => {
    let liste = poolDisponible;
    if (filtreVille) liste = liste.filter((c) => c.ville === filtreVille);
    const q = rechercheColis.trim().toLowerCase();
    if (q) {
      liste = liste.filter((c) => c.codeSuivi.toLowerCase().includes(q) || c.clientNom.toLowerCase().includes(q));
    }
    return liste;
  }, [poolDisponible, filtreVille, rechercheColis]);

  const poolAffiche = poolFiltre.slice(0, limiteAffichage);
  const resteAAfficher = Math.max(0, poolFiltre.length - poolAffiche.length);

  const totalCrbt = bon.reduce((s, c) => s + Number(c.montantCod), 0);
  const totalPoids = bon.reduce((s, c) => s + Number(c.poidsKg ?? 0), 0);

  function resetApresHub() {
    setLivreurId('');
    setRechercheLivreur('');
    setEligibles([]);
    setRechercheColis('');
    setFiltreVille(null);
    setLimiteAffichage(PAGE_SIZE_COLIS);
    setBon([]);
    setScanValue('');
    setMessage(null);
  }

  function handleZonePick(id: string) {
    setHubId(id);
    resetApresHub();
    setEtape('tournee');
  }

  function handleZoneChange() {
    setHubId('');
    resetApresHub();
    setEtape('zone');
  }

  function handleLivreurPick(id: string) {
    setLivreurId((prev) => (prev === id ? '' : id));
    setBon([]);
    setRechercheColis('');
    setFiltreVille(null);
    setLimiteAffichage(PAGE_SIZE_COLIS);
    setMessage(null);
  }

  function ajouterColis(c: Commande) {
    setBon((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
  }

  function handleColisAdd(id: string) {
    const c = eligibles.find((x) => x.id === id);
    if (c) ajouterColis(c);
  }

  function handleColisRemove(id: string) {
    setBon((prev) => prev.filter((c) => c.id !== id));
  }

  function handleDropColis(id: string, index: number | null) {
    const c = eligibles.find((x) => x.id === id);
    if (!c || bonIds.has(c.id)) return;
    setBon((prev) => {
      const next = [...prev];
      next.splice(index ?? next.length, 0, c);
      return next;
    });
  }

  function handleReorder(id: string, index: number) {
    setBon((prev) => {
      const current = prev.findIndex((c) => c.id === id);
      if (current === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(current, 1);
      const cible = current < index ? index - 1 : index;
      next.splice(Math.max(0, Math.min(next.length, cible)), 0, item);
      return next;
    });
  }

  function handleAjouterFiltre() {
    setBon((prev) => {
      const ids = new Set(prev.map((c) => c.id));
      return [...prev, ...poolFiltre.filter((c) => !ids.has(c.id))];
    });
  }

  async function handleScanSubmit() {
    const raw = scanValue.trim();
    if (!raw || scanning || !hubId || !livreurId) return;
    setScanning(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = raw.includes('.')
        ? { qrPayload: raw, hubId, livreurId }
        : { codeSuivi: raw, hubId, livreurId };
      const commande = await apiPost<Commande>('/api/bons-distribution/scan', body);
      ajouterColis(commande);
      setMessage(`Colis ${commande.codeSuivi} ajouté au bon.`);
      setScanValue('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erreur de scan');
    } finally {
      setScanning(false);
    }
  }

  function handleReset() {
    setHubId('');
    resetApresHub();
    setEtape('zone');
    setCodeBD(null);
    setStatutLabel('Nouveau');
    setError(null);
  }

  function handleValider() {
    if (bon.length === 0) return;
    setConfirmationOuverte(true);
  }

  async function handleConfirmer() {
    if (!hubId || !livreurId || bon.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiPost<BonDistribution>('/api/bons-distribution', {
        hubId,
        livreurId,
        colisIds: bon.map((c) => c.id),
      });
      setCodeBD(created.numero);
      setStatutLabel('En cours');
      setConfirmationOuverte(false);
      router.push(`/admin/bon-distribution/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setConfirmationOuverte(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="px-1 text-sm font-medium text-red-600">{error}</p>}

      <BonDistributionCreerUI
        codeBD={codeBD}
        statutLabel={statutLabel}
        statutTone={statutLabel === 'En cours' ? 'ok' : 'warn'}
        etape={etape}
        zones={hubs.map((h) => {
          const nbColis = h.nbColisAuHub ?? 0;
          const maxColis = Math.max(1, ...hubs.map((hh) => hh.nbColisAuHub ?? 0));
          return {
            id: h.id,
            nom: h.nom,
            nbColis,
            nbLivreurs: h.nbLivreursActifs ?? 0,
            ratio: nbColis / maxColis,
          };
        })}
        zone={hubSelectionne ? { nom: hubSelectionne.nom } : null}
        livreurs={livreursFiltres.map((l) => ({
          id: l.id,
          nom: l.nomComplet,
          initiales: initiales(l.nomComplet),
          ligneSecondaire: l.telephone ?? '',
          compteur: String(l.nbColisEligibles),
          selected: l.id === livreurId,
        }))}
        livreurCompteur={`${livreursFiltres.length}/${livreurs.length}`}
        rechercheLivreur={rechercheLivreur}
        livreurNom={livreurSelectionne?.nomComplet ?? ''}
        colis={poolAffiche.map((c) => ({
          id: c.id,
          code: c.codeSuivi,
          client: c.clientNom,
          ville: c.ville,
          quartier: '',
          crbt: formatDh(Number(c.montantCod)),
        }))}
        colisCompteur={`${poolAffiche.length} / ${poolFiltre.length}`}
        rechercheColis={rechercheColis}
        filtres={filtres}
        resteAAfficher={resteAAfficher}
        bon={bon.map((c) => ({
          id: c.id,
          code: c.codeSuivi,
          ligneSecondaire: c.ville,
          crbt: formatDh(Number(c.montantCod)),
        }))}
        totaux={[
          { label: 'COLIS', value: String(bon.length) },
          { label: 'CRBT', value: formatDh(totalCrbt) },
          { label: 'POIDS', value: `${totalPoids.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg` },
        ]}
        scanValue={scanValue}
        scanVisible
        message={message}
        journal={[]}
        confirmation={
          confirmationOuverte
            ? {
                ouverte: true,
                titre: `Confirmer le Bon de Distribution`,
                sousTitre: `${livreurSelectionne?.nomComplet ?? ''} — ${hubSelectionne?.nom ?? ''}`,
                totaux: [
                  { label: 'COLIS', value: String(bon.length) },
                  { label: 'CRBT', value: formatDh(totalCrbt) },
                  { label: 'POIDS', value: `${totalPoids.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg` },
                ],
                texte: creating
                  ? 'Création en cours…'
                  : "Les colis sélectionnés passeront en « Mise en distribution » et seront affectés à ce livreur.",
              }
            : null
        }
        onZonePick={handleZonePick}
        onZoneChange={handleZoneChange}
        onLivreurPick={handleLivreurPick}
        onRechercheLivreur={setRechercheLivreur}
        onRechercheColis={setRechercheColis}
        onFiltrePick={(id: string) => setFiltreVille(id === 'tous' ? null : id)}
        onColisAdd={handleColisAdd}
        onColisRemove={handleColisRemove}
        onAfficherPlus={() => setLimiteAffichage((n) => n + PAGE_SIZE_COLIS)}
        onAjouterFiltre={handleAjouterFiltre}
        onDropColis={handleDropColis}
        onReorder={handleReorder}
        onScanChange={setScanValue}
        onScanSubmit={handleScanSubmit}
        onValider={handleValider}
        onReset={handleReset}
        onConfirmer={handleConfirmer}
        onAnnuler={() => setConfirmationOuverte(false)}
      />
    </div>
  );
}
