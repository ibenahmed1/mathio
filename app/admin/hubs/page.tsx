'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Map, MapPin, Pencil, Plus, Search, Tag, Trash2, Warehouse, X } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Hub, Prestataire, Ville } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import './hubs.css';

type ModalState =
  | { kind: 'hub'; mode: 'create' }
  | { kind: 'hub'; mode: 'edit'; hub: Hub }
  | { kind: 'ville'; mode: 'create'; hubId: string }
  | { kind: 'ville'; mode: 'edit'; ville: Ville }
  | { kind: 'prestataire'; mode: 'create' }
  | { kind: 'prestataire'; mode: 'edit'; prestataire: Prestataire }
  | null;

type Filtre = 'tous' | 'interne' | 'soustraite';

// Nombre de puces de villes affichées avant le repli « + N autres » : au-delà,
// une agence comme Marrakech (41 villes) noierait la carte et ses actions.
const VILLES_AVANT_REPLI = 12;

// Identité colorée d'un hub. La couleur n'est plus tirée d'un hachage du nom —
// elle alternait alors sans raison lisible d'une carte à l'autre — mais dit à
// QUI appartient le hub :
//   • marine  → le hub central ;
//   • bleu    → les hubs internes, tous la même teinte ;
//   • chaud   → une teinte par prestataire, la même pour toutes ses agences.
// Comme le tri regroupe les agences par prestataire, la grille se lit en blocs
// de couleur, et deux cartes de même teinte disent toujours la même chose.
const GRADIENTS: Record<string, string> = {
  navy: 'linear-gradient(135deg,#023047,#14526E)',
  blue: 'linear-gradient(135deg,#8ECAE6,#219EBC)',
  yellow: 'linear-gradient(135deg,#FFB701,#E8A400)',
  accent: 'linear-gradient(135deg,#FFB701,#FC8500)',
  orange: 'linear-gradient(135deg,#FC8500,#E56A00)',
  orangeDeep: 'linear-gradient(135deg,#E56A00,#C25400)',
  brique: 'linear-gradient(135deg,#C25400,#9E4300)',
};

// Rangées dans l'ordre où elles seront distribuées : du plus clair au plus
// soutenu, pour que deux prestataires voisins dans l'alphabet restent
// distinguables au premier coup d'œil. Cinq marches pour cinq prestataires
// (Amir, EST, Meta, Power, Sahario) — au-delà la suite reboucle, et deux
// réseaux se retrouveraient de la même couleur : il faudra alors trancher
// autrement qu'en ajoutant une nuance de plus, l'œil ne suivrait pas.
const GRADIENTS_AGENCE = ['yellow', 'accent', 'orange', 'orangeDeep', 'brique'];

// Teinte de chaque prestataire, attribuée dans l'ordre alphabétique de leur
// nom : elle ne bouge donc pas d'un rechargement à l'autre, et n'est
// redistribuée que si un prestataire entre ou sort.
function couleursParPrestataire(hubs: Hub[]): Record<string, string> {
  const noms: Record<string, string> = {};
  for (const hub of hubs) {
    if (hub.prestataireId) noms[hub.prestataireId] = hub.prestataire?.nom ?? hub.prestataireId;
  }
  const ids = Object.keys(noms).sort((a, b) => noms[a].localeCompare(noms[b], 'fr', { sensitivity: 'base' }));
  const couleurs: Record<string, string> = {};
  ids.forEach((id, i) => {
    couleurs[id] = GRADIENTS[GRADIENTS_AGENCE[i % GRADIENTS_AGENCE.length]];
  });
  return couleurs;
}

function gradientDeHub(hub: Hub, couleursAgence: Record<string, string>): string {
  if (hub.isCentral) return GRADIENTS.navy;
  if (!hub.prestataireId) return GRADIENTS.blue;
  return couleursAgence[hub.prestataireId] ?? GRADIENTS.accent;
}

// Ordre d'affichage : le hub central d'abord, puis les hubs internes, puis les
// agences sous-traitées, celles-ci groupées par prestataire. C'est l'ordre du
// réseau lui-même, et il fait tomber les couleurs en blocs continus.
function rangDeHub(hub: Hub): number {
  if (hub.isCentral) return 0;
  return hub.prestataireId ? 2 : 1;
}

// « Agence El Jadida » → EJ, « Hub Casablanca » → CA. Le préfixe est retiré
// avant l'initiale : sans ça, tous les hubs afficheraient « HU » ou « AG ».
function initiales(nom: string): string {
  const mots = nom.replace(/^(hub|agence)\s+/i, '').trim().split(/\s+/);
  if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
  return (mots[0] ?? '?').slice(0, 2).toUpperCase();
}

// Tarif retenu pour une ville : celui du prestataire qui l'exploite quand le
// hub est sous-traité, sinon le meilleur tarif connu chez n'importe quel
// prestataire — sur un hub interne ce n'est pas un coût réel mais un ordre de
// grandeur, et le libellé le dit (« Tarification indicative »).
function tarifDeVille(ville: Ville, hub: Hub): number | null {
  if (hub.prestataireId) {
    return ville.tarifPrestataire == null ? null : Number(ville.tarifPrestataire);
  }
  const connus = (ville.tarifsPrestataires ?? []).map((t) => Number(t.tarifLivraison));
  return connus.length > 0 ? Math.min(...connus) : null;
}

export default function AdminHubsPage() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  // § Sous-traitance : les prestataires vivent sur le même écran que les hubs,
  // parce que c'est le même référentiel vu des deux côtés — un hub est soit
  // exploité par nous, soit par l'un d'eux.
  const [prestataires, setPrestataires] = useState<Prestataire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  // Hub visé par le formulaire de ville, suivi à part : c'est lui qui décide si
  // le champ tarif a un sens (agence) ou non (hub interne).
  const [villeHubId, setVilleHubId] = useState<string>('');
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  // Cartes dont la grille tarifaire est dépliée, et celles qui montrent la
  // totalité de leurs villes plutôt que les douze premières.
  const [depliees, setDepliees] = useState<Set<string>>(new Set());
  const [completes, setCompletes] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const [resHubs, resPrestataires] = await Promise.all([
        apiGet<{ data: Hub[] }>('/api/hubs'),
        apiGet<{ data: Prestataire[] }>('/api/prestataires'),
      ]);
      setHubs(resHubs.data);
      setPrestataires(resPrestataires.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  const totaux = useMemo(() => {
    const villes = hubs.reduce((total, h) => total + (h.villes?.length ?? 0), 0);
    const colisDepot = hubs.reduce((total, h) => total + (h.nbColisDepot ?? 0), 0);
    const agences = hubs.filter((h) => h.prestataireId).length;
    return { hubs: hubs.length, agences, villes, colisDepot };
  }, [hubs]);

  const hubsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const retenus = hubs.filter((hub) => {
      if (filtre === 'interne' && hub.prestataireId) return false;
      if (filtre === 'soustraite' && !hub.prestataireId) return false;
      if (!q) return true;
      // La recherche porte aussi sur les VILLES : on cherche bien plus souvent
      // « qui livre Tahannaout ? » que le nom d'une agence qu'on connaît déjà.
      return (
        hub.nom.toLowerCase().includes(q) ||
        hub.ville.toLowerCase().includes(q) ||
        (hub.prestataire?.nom.toLowerCase().includes(q) ?? false) ||
        (hub.villes ?? []).some((v) => v.nom.toLowerCase().includes(q))
      );
    });
    return [...retenus].sort(
      (a, b) =>
        rangDeHub(a) - rangDeHub(b) ||
        (a.prestataire?.nom ?? '').localeCompare(b.prestataire?.nom ?? '', 'fr', { sensitivity: 'base' }) ||
        a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })
    );
  }, [hubs, recherche, filtre]);

  const couleursAgence = useMemo(() => couleursParPrestataire(hubs), [hubs]);

  function basculer(ensemble: Set<string>, id: string): Set<string> {
    const suivant = new Set(ensemble);
    if (suivant.has(id)) suivant.delete(id);
    else suivant.add(id);
    return suivant;
  }

  function ouvrirVille(state: Extract<ModalState, { kind: 'ville' }>) {
    setVilleHubId(state.mode === 'create' ? state.hubId : state.ville.hubId);
    setModal(state);
  }

  async function handleHubSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'hub') return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      nom: String(fd.get('nom') ?? ''),
      ville: String(fd.get('ville') ?? ''),
      adresse: String(fd.get('adresse') ?? ''),
      telephone: String(fd.get('telephone') ?? ''),
      isCentral: fd.get('isCentral') === 'on',
      // Chaîne vide = hub interne : l'API la traduit en détachement.
      prestataireId: String(fd.get('prestataireId') ?? ''),
    };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/hubs', payload);
      } else {
        await apiPatch(`/api/hubs/${modal.hub.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleVilleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'ville') return;
    const fd = new FormData(e.currentTarget);
    const hubId = String(fd.get('hubId') ?? '');
    const tarifSaisi = String(fd.get('tarif') ?? '').trim();
    const retourSaisi = String(fd.get('tarifRetour') ?? '').trim();
    const sousTraite = Boolean(hubs.find((h) => h.id === hubId)?.prestataireId);
    const payload = {
      nom: String(fd.get('nom') ?? ''),
      hubId,
      // Champ vide sur une agence = tarif retiré (ville non tarifée) ; sur un
      // hub interne, l'API l'ignore — il n'y a pas de prestataire à facturer.
      tarif: sousTraite ? (tarifSaisi === '' ? null : tarifSaisi) : undefined,
      tarifRetour: sousTraite ? (retourSaisi === '' ? null : retourSaisi) : undefined,
    };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/villes', payload);
      } else {
        await apiPatch(`/api/villes/${modal.ville.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handlePrestataireSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'prestataire') return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      nom: String(fd.get('nom') ?? ''),
      contact: String(fd.get('contact') ?? ''),
      telephone: String(fd.get('telephone') ?? ''),
      email: String(fd.get('email') ?? ''),
      actif: fd.get('actif') === 'on',
    };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/prestataires', payload);
      } else {
        await apiPatch(`/api/prestataires/${modal.prestataire.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimerHub(hub: Hub) {
    if (!window.confirm(`Supprimer le hub "${hub.nom}" ? Cette action est irréversible.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/hubs/${hub.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimerVille(ville: Ville) {
    if (!window.confirm(`Supprimer la ville "${ville.nom}" ?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/villes/${ville.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  // Ouvre la fiche d'un prestataire depuis la carte d'une de ses agences.
  // Sa SUPPRESSION n'a plus de point d'entrée, le bandeau qui la portait ayant
  // été retiré : `DELETE /api/prestataires/[id]` existe toujours et reste
  // protégé (refus tant qu'une agence lui est rattachée), il n'est simplement
  // plus appelé d'ici.
  function ouvrirPrestataire(id: string) {
    const prestataire = prestataires.find((p) => p.id === id);
    if (prestataire) setModal({ kind: 'prestataire', mode: 'edit', prestataire });
  }

  const hubFormulaireVille = hubs.find((h) => h.id === villeHubId) ?? null;

  return (
    <div className="hubs-page">
      {/* En-tête et filtres reprennent les composants de `globals.css`
          (`page-title`, `btn-primary`, `btn-outline`, `input-basic`,
          `dashboard-card`) plutôt que les leurs : cette page se lit à la suite
          des autres écrans admin, elle doit ouvrir comme eux. Seules les CARTES
          gardent leur feuille propre — c'est là qu'est la valeur du dessin. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Gestion des Hubs</h1>
          <p className="mt-0.5 text-sm opacity-60">
            {totaux.hubs} hub{totaux.hubs > 1 ? 's' : ''} dont {totaux.agences} sous-traité{totaux.agences > 1 ? 's' : ''} ·{' '}
            {totaux.villes} ville{totaux.villes > 1 ? 's' : ''} · {totaux.colisDepot} colis au dépôt
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => setModal({ kind: 'prestataire', mode: 'create' })}>
            <Building2 className="h-4 w-4" /> Nouveau prestataire
          </button>
          <button type="button" className="btn-primary" onClick={() => setModal({ kind: 'hub', mode: 'create' })}>
            <Plus className="h-4 w-4" /> Nouveau hub
          </button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="dashboard-card flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            className="input-basic w-full pl-9"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Hub, prestataire ou ville…"
            aria-label="Rechercher un hub ou une ville"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider opacity-45">Exploitation</span>
          {(
            [
              ['tous', 'Tous'],
              ['interne', 'Internes'],
              ['soustraite', 'Sous-traités'],
            ] as const
          ).map(([valeur, label]) => (
            <button
              key={valeur}
              type="button"
              className={filtre === valeur ? 'btn-primary' : 'btn-outline'}
              onClick={() => setFiltre(valeur)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto rounded-full bg-brand/20 px-3 py-1.5 text-sm font-semibold">
          {totaux.colisDepot} colis au dépôt
        </span>
      </div>

      <div className="hub-grid">
        {hubsFiltres.map((hub) => {
          const gradient = gradientDeHub(hub, couleursAgence);
          const villes = hub.villes ?? [];
          const apercu = villes.slice(0, 5).map((v) => v.nom);
          const reste = villes.length - apercu.length;

          const tarifs = villes.map((v) => tarifDeVille(v, hub)).filter((t): t is number => t !== null);
          const moyenne = tarifs.length > 0 ? Math.round(tarifs.reduce((s, t) => s + t, 0) / tarifs.length) : null;

          const estDepliee = depliees.has(hub.id);
          const toutMontrer = completes.has(hub.id);
          const chips = toutMontrer ? villes : villes.slice(0, VILLES_AVANT_REPLI);

          return (
            <article key={hub.id} className="hub-card">
              <header className="hub-card__header" style={{ background: gradient }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="hub-card__name">{hub.nom}</div>
                    {/* Le nom du prestataire ouvre sa fiche : le bandeau qui
                        listait les prestataires a été retiré, et sans ce point
                        d'entrée on ne pourrait plus en renommer un ni corriger
                        ses coordonnées. Aucun chrome ajouté — c'est la ligne de
                        service, déjà affichée. */}
                    <div className="hub-card__sub">
                      {hub.prestataire ? (
                        <button
                          type="button"
                          className="hub-card__sub-lien"
                          title={`Modifier ${hub.prestataire.nom}`}
                          onClick={() => ouvrirPrestataire(hub.prestataire!.id)}
                        >
                          {hub.prestataire.nom}
                        </button>
                      ) : hub.isCentral ? (
                        'Hub central'
                      ) : (
                        'Hub interne'
                      )}{' '}
                      · {hub.ville}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span className="hub-card__pill">
                      {villes.length} ville{villes.length > 1 ? 's' : ''}
                    </span>
                    {hub.isCentral && <span className="hub-card__tag">CENTRAL</span>}
                    {hub.prestataireId && <span className="hub-card__tag">SOUS-TRAITÉ</span>}
                  </div>
                </div>
                <Warehouse size={92} strokeWidth={1} className="hub-card__watermark" fill="none" />
              </header>

              <div className="hub-card__body">
                <div className="hub-card__identity">
                  <div className="hub-card__logo">
                    <span style={{ background: gradient }}>{initiales(hub.nom)}</span>
                  </div>
                  <span className={`hub-card__colis ${(hub.nbColisDepot ?? 0) > 0 ? 'hub-card__colis--pending' : ''}`}>
                    {hub.nbColisDepot ?? 0} colis au dépôt
                  </span>
                </div>

                <div className="hub-card__info">
                  <div className="row">
                    <MapPin size={14} />
                    <span>
                      <b>Ville siège :</b> {hub.ville}
                    </span>
                  </div>
                  <div className="row">
                    <Map size={14} />
                    <span>
                      <b>Zone desservie :</b>{' '}
                      {villes.length === 0 ? (
                        <span className="muted">Aucune ville desservie pour le moment.</span>
                      ) : (
                        <span className="muted">
                          {apercu.join(', ')}
                          {reste > 0 ? ` + ${reste} autre${reste > 1 ? 's' : ''}` : ''}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="row">
                    <Tag size={14} />
                    <span>
                      {/* Sur un hub interne, ce prix n'est pas un coût constaté
                          mais ce que ces villes coûteraient en sous-traitance :
                          le libellé doit le dire, sans quoi on lirait une
                          dépense là où il n'y en a pas. */}
                      <b>{hub.prestataireId ? 'Tarification :' : 'Tarification indicative :'}</b>{' '}
                      {moyenne === null ? (
                        <span className="muted">Aucun tarif défini</span>
                      ) : (
                        <span className="muted">
                          {moyenne} DH en moyenne · de {Math.min(...tarifs)} à {Math.max(...tarifs)} DH
                          {tarifs.length < villes.length ? ` · ${villes.length - tarifs.length} sans tarif` : ''}
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {estDepliee && (
                  <div className="hub-card__tarifs">
                    {chips.map((ville) => {
                      const tarif = tarifDeVille(ville, hub);
                      return (
                        <span key={ville.id} className="city-chip">
                          <button
                            type="button"
                            className="city-chip__name"
                            title={`Modifier ${ville.nom}`}
                            onClick={() => ouvrirVille({ kind: 'ville', mode: 'edit', ville })}
                          >
                            {ville.nom}
                          </button>
                          {tarif !== null && <span className="price">{tarif} DH</span>}
                          <button
                            type="button"
                            className="remove"
                            title={`Supprimer ${ville.nom}`}
                            onClick={() => supprimerVille(ville)}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      );
                    })}
                    {!toutMontrer && villes.length > VILLES_AVANT_REPLI && (
                      <button
                        type="button"
                        className="city-chip city-chip--more"
                        onClick={() => setCompletes((c) => basculer(c, hub.id))}
                      >
                        + {villes.length - VILLES_AVANT_REPLI} autres
                      </button>
                    )}
                    <button
                      type="button"
                      className="city-chip city-chip--add"
                      onClick={() => ouvrirVille({ kind: 'ville', mode: 'create', hubId: hub.id })}
                    >
                      <Plus size={12} /> Ajouter
                    </button>
                  </div>
                )}

                <div className="hub-card__actions">
                  <button type="button" className="hub-btn" onClick={() => setDepliees((d) => basculer(d, hub.id))}>
                    <MapPin size={16} /> {estDepliee ? 'Masquer les villes' : 'Gérer les villes'}
                  </button>
                  <button
                    type="button"
                    className="hub-btn hub-btn--icon"
                    aria-label={`Modifier ${hub.nom}`}
                    onClick={() => setModal({ kind: 'hub', mode: 'edit', hub })}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    className="hub-btn hub-btn--icon is-danger"
                    aria-label={`Supprimer ${hub.nom}`}
                    onClick={() => supprimerHub(hub)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {hubsFiltres.length === 0 && (
          <p className="hub-empty">
            {hubs.length === 0 ? 'Aucun hub enregistré.' : 'Aucun hub ne correspond à cette recherche.'}
          </p>
        )}
      </div>

      {modal?.kind === 'hub' && (
        <Modal title={modal.mode === 'create' ? 'Nouveau hub' : 'Modifier le hub'} onClose={() => setModal(null)}>
          <form onSubmit={handleHubSubmit} className="flex flex-col gap-4">
            <Field label="Nom du hub" required>
              <input name="nom" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.hub.nom : ''} required />
            </Field>
            <Field label="Ville" required>
              <input name="ville" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.hub.ville : ''} required />
            </Field>
            <div className="form-grid">
              <Field label="Adresse" optional>
                <input
                  name="adresse"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.hub.adresse ?? '') : ''}
                />
              </Field>
              <Field label="Téléphone" optional>
                <input
                  name="telephone"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.hub.telephone ?? '') : ''}
                />
              </Field>
            </div>
            <Field label="Exploitation" optional>
              <select
                name="prestataireId"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? (modal.hub.prestataireId ?? '') : ''}
              >
                <option value="">Interne — livré par nos livreurs</option>
                {prestataires.map((p) => (
                  <option key={p.id} value={p.id}>
                    Sous-traité — {p.nom}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs opacity-60">
                Une agence sous-traitée n&apos;a ni livreur rattaché ni bon de distribution : le prestataire livre lui-même les
                villes du hub, à sa grille tarifaire.
              </p>
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                name="isCentral"
                className="check-basic"
                defaultChecked={modal.mode === 'edit' ? modal.hub.isCentral : false}
              />
              Hub central (entrepôt principal de préparation)
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.kind === 'ville' && (
        <Modal title={modal.mode === 'create' ? 'Nouvelle ville' : 'Modifier la ville'} onClose={() => setModal(null)}>
          <form onSubmit={handleVilleSubmit} className="flex flex-col gap-4">
            <Field label="Nom de la ville" required>
              <input name="nom" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.ville.nom : ''} required />
            </Field>
            <Field label="Hub" required>
              <select
                name="hubId"
                className="input-basic"
                value={villeHubId}
                onChange={(e) => setVilleHubId(e.target.value)}
                required
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.nom}
                    {h.prestataire ? ` — ${h.prestataire.nom}` : ' — interne'}
                  </option>
                ))}
              </select>
            </Field>
            {/* Le tarif n'existe que face à un prestataire : sur un hub interne
                le coût de la ville est celui du livreur (grille livreur/ville). */}
            {hubFormulaireVille?.prestataire && (
              <>
                <div className="form-grid">
                  <Field label={`Tarif livraison ${hubFormulaireVille.prestataire.nom} (DH)`} optional>
                    <input
                      name="tarif"
                      type="number"
                      min="0"
                      step="0.01"
                      className="input-basic"
                      defaultValue={modal.mode === 'edit' ? (modal.ville.tarifPrestataire ?? '') : ''}
                    />
                  </Field>
                  <Field label="Tarif retour (DH)" optional>
                    <input
                      name="tarifRetour"
                      type="number"
                      min="0"
                      step="0.01"
                      className="input-basic"
                      defaultValue={modal.mode === 'edit' ? (modal.ville.tarifPrestataireRetour ?? '') : ''}
                    />
                  </Field>
                </div>
                <p className="-mt-2 text-xs opacity-60">
                  Ce que le prestataire nous facture pour cette ville. Laisser vide si le tarif n&apos;est pas encore convenu —
                  la marge des colis concernés sera alors signalée comme incomplète en facturation.
                </p>
              </>
            )}
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.kind === 'prestataire' && (
        <Modal
          title={modal.mode === 'create' ? 'Nouveau prestataire' : 'Modifier le prestataire'}
          onClose={() => setModal(null)}
        >
          <form onSubmit={handlePrestataireSubmit} className="flex flex-col gap-4">
            <Field label="Nom du prestataire" required>
              <input
                name="nom"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.prestataire.nom : ''}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Contact" optional>
                <input
                  name="contact"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.prestataire.contact ?? '') : ''}
                />
              </Field>
              <Field label="Téléphone" optional>
                <input
                  name="telephone"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.prestataire.telephone ?? '') : ''}
                />
              </Field>
            </div>
            <Field label="Email" optional>
              <input
                name="email"
                type="email"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? (modal.prestataire.email ?? '') : ''}
              />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                name="actif"
                className="check-basic"
                defaultChecked={modal.mode === 'edit' ? modal.prestataire.actif : true}
              />
              Prestataire actif
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
