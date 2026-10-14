'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Camera, Pencil, TriangleAlert, Undo2 } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import { P, StatusPill } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';
import { CodeColis } from '@/components/colis/CodeColis';

// § Règlements transporteurs (décidé le 13/10/2026, SOUS_TRAITANCE.md) — ce que
// chaque transporteur nous doit pour les colis livrés qu'on lui a confiés : il
// encaisse le COD, garde ses frais, nous reverse le reste sous 24 h. On coche
// les colis couverts par un versement, on « Marque payé » (photo du reçu
// facultative) : la recette part au journal comptable.

interface Synthese {
  id: string;
  nom: string;
  attendu: number;
  nbARecevoir: number;
  nbEnRetard: number;
  montantEnRetard: number;
  recuCeMois: number;
  ecarts: number;
  nbFraisInconnus: number;
}

interface Creance {
  id: string;
  commandeId: string;
  codeSuivi: string;
  ville: string;
  clientNom: string;
  marchandNom: string | null;
  montantCod: number;
  fraisTransporteur: number | null;
  montantAttendu: number;
  dateLivraison: string;
  enRetard: boolean;
}

interface Versement {
  id: string;
  numero: number;
  montantRecu: number;
  montantAttendu: number;
  ecart: number;
  dateVersement: string;
  note: string | null;
  nbColis: number;
  preuve: boolean;
  auteur: string;
  annuleLe: string | null;
  annulePar: string | null;
}

const DEGRADES: [string, string][] = [
  ['#8ECAE6', '#209EBB'],
  ['#209EBB', '#023047'],
  ['#FFE14D', '#FFB701'],
  ['#FFB701', '#FC8500'],
  ['#023047', '#4A4A45'],
  ['#14526E', '#209EBB'],
  ['#FC8500', '#E56A00'],
];

const dh = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
}

function lireFichier(fichier: File): Promise<string> {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(String(lecteur.result));
    lecteur.onerror = () => ko(new Error('Photo illisible'));
    lecteur.readAsDataURL(fichier);
  });
}

export default function ReglementsTransporteursPage() {
  const [transporteurs, setTransporteurs] = useState<Synthese[]>([]);
  const [sansTarif, setSansTarif] = useState<{ transporteur: string; villes: string[] }[]>([]);
  const [voirSansTarif, setVoirSansTarif] = useState(false);
  const [choisi, setChoisi] = useState<Synthese | null>(null);
  const [creances, setCreances] = useState<Creance[]>([]);
  const [versements, setVersements] = useState<Versement[]>([]);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [fenetre, setFenetre] = useState<{ mode: 'payer' } | { mode: 'modifier'; versement: Versement } | null>(null);

  const chargerSynthese = useCallback(async () => {
    const res = await apiGet<{ transporteurs: Synthese[]; villesSansTarif: { transporteur: string; villes: string[] }[] }>(
      '/api/reglements-transporteurs'
    );
    setTransporteurs(res.transporteurs);
    setSansTarif(res.villesSansTarif);
    return res.transporteurs;
  }, []);

  useEffect(() => {
    Promise.resolve()
      .then(() => chargerSynthese())
      .catch((e) => setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Erreur' }))
      .finally(() => setChargement(false));
  }, [chargerSynthese]);

  async function ouvrir(t: Synthese) {
    setChoisi(t);
    setCoches(new Set());
    const res = await apiGet<{ creances: Creance[]; versements: Versement[] }>(`/api/reglements-transporteurs/${t.id}`);
    setCreances(res.creances);
    setVersements(res.versements);
  }

  async function rafraichir(texte: string) {
    window.dispatchEvent(new Event('compteurs:maj'));
    const maj = await chargerSynthese();
    const t = choisi ? maj.find((x) => x.id === choisi.id) : null;
    if (t) await ouvrir(t);
    setMessage({ ok: true, texte });
  }

  async function annuler(v: Versement) {
    const motif = window.prompt(`Annuler le versement n° ${v.numero} ? Ses ${v.nbColis} colis redeviendront « à recevoir ». Motif (facultatif) :`);
    if (motif === null) return;
    try {
      await apiPost(`/api/reglements-transporteurs/versements/${v.id}/annuler`, { motif });
      await rafraichir(`Versement n° ${v.numero} annulé`);
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Erreur' });
    }
  }

  const total = (cle: keyof Pick<Synthese, 'attendu' | 'montantEnRetard' | 'recuCeMois' | 'ecarts'>) =>
    transporteurs.reduce((n, t) => n + t[cle], 0);
  const nbRetard = transporteurs.reduce((n, t) => n + t.nbEnRetard, 0);
  const nbVillesSansTarif = sansTarif.reduce((n, x) => n + x.villes.length, 0);
  const degradeDe = (id: string) => DEGRADES[Math.max(0, transporteurs.findIndex((t) => t.id === id)) % DEGRADES.length];
  const tousCoches = creances.length > 0 && creances.every((c) => coches.has(c.id));
  const attenduCoche = creances.filter((c) => coches.has(c.id)).reduce((n, c) => n + c.montantAttendu, 0);

  return (
    <main className={s.main}>
      <header className={s.entete}>
        <h1 className={s.titre}>Règlements transporteurs</h1>
      </header>

      {/* ===== Cadrans ===== */}
      <section className={`${s.card} ${s.kpiRow}`}>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
          <span className={s.kpiLabel}>Attendu</span>
          <span className={s.kpiValeur}>{dh(total('attendu'))}</span>
          <span className={s.kpiNote}>COD encaissé par les transporteurs, leurs frais déduits</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#FFB701,#FC8500)', color: P.navy }}>
          <span className={s.kpiLabel}>En retard</span>
          <span className={s.kpiValeur}>{dh(total('montantEnRetard'))}</span>
          <span className={s.kpiNote}>{nbRetard} colis livré{nbRetard > 1 ? 's' : ''} depuis plus de 24 h</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
          <span className={s.kpiLabel} style={{ color: P.jaune }}>Reçu ce mois</span>
          <span className={s.kpiValeur}>{dh(total('recuCeMois'))}</span>
          <span className={s.kpiNote}>Versements enregistrés</span>
        </div>
        <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
          <span className={s.kpiLabel}>Écarts</span>
          <span className={s.kpiValeur}>{dh(total('ecarts'))}</span>
          <span className={s.kpiNote}>Reçu − attendu, tous versements</span>
        </div>
      </section>

      {nbVillesSansTarif > 0 && (
        <div className={s.alerte} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {nbVillesSansTarif} ville{nbVillesSansTarif > 1 ? 's' : ''} desservie{nbVillesSansTarif > 1 ? 's' : ''} sans tarif : on ne
            sait pas ce que le transporteur y garde. Toutes les villes doivent avoir un tarif.
            <button type="button" className={s.btnClair} style={{ padding: '4px 10px' }} onClick={() => setVoirSansTarif((v) => !v)}>
              {voirSansTarif ? 'Masquer' : 'Voir lesquelles'}
            </button>
          </span>
          {voirSansTarif &&
            sansTarif.map((x) => (
              <span key={x.transporteur} style={{ fontWeight: 500 }}>
                <b>{x.transporteur}</b> : {x.villes.join(', ')}
              </span>
            ))}
        </div>
      )}

      {message && (
        <div className={`${s.card} ${s.message} ${message.ok ? '' : s.messageErreur}`} role={message.ok ? 'status' : 'alert'}>
          <span className={s.messageTexte}>{message.texte}</span>
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
                  t.nbARecevoir === 0 ? s.transporteurVide : ''
                }`}
              >
                <span className={s.transporteurTete}>
                  <span className={s.avatar} style={{ background: `linear-gradient(135deg,${a},${b})` }}>
                    {initiales(t.nom)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className={s.nom}>{t.nom}</span>
                    <span className={s.nomSous}>
                      {t.nbARecevoir === 0 ? 'Rien à recevoir' : `${t.nbARecevoir} colis à recevoir`}
                    </span>
                  </span>
                </span>
                <span className={s.compte}>
                  <span className={s.compteValeur} style={{ fontSize: 22 }}>
                    {dh(t.attendu)}
                  </span>
                </span>
                <span className={s.nomSous} style={{ color: t.nbEnRetard ? '#B85200' : undefined, fontWeight: t.nbEnRetard ? 700 : 400 }}>
                  {t.nbEnRetard ? `${t.nbEnRetard} en retard · ${dh(t.montantEnRetard)}` : 'Aucun retard'}
                  {t.nbFraisInconnus > 0 && ` · ${t.nbFraisInconnus} sans tarif`}
                </span>
                {t.nbEnRetard > 0 && <span className={s.pastille}>{t.nbEnRetard > 99 ? '99+' : t.nbEnRetard}</span>}
              </button>
            );
          })}
        </section>
      )}

      {choisi && (
        <>
          {/* ===== Colis à recevoir ===== */}
          <section className={`${s.card} ${s.panneau}`}>
            <div className={s.panneauTete}>
              <div className={s.transporteurTete}>
                <span className={s.avatar} style={{ background: `linear-gradient(135deg,${degradeDe(choisi.id)[0]},${degradeDe(choisi.id)[1]})` }}>
                  {initiales(choisi.nom)}
                </span>
                <div>
                  <h2 className={s.sectionTitre}>{choisi.nom} — colis livrés à recevoir</h2>
                  <span style={{ fontSize: 12, color: '#8C8C86' }}>Cochez les colis couverts par le versement reçu</span>
                </div>
              </div>
            </div>

            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={tousCoches}
                        onChange={() => setCoches(tousCoches ? new Set() : new Set(creances.map((c) => c.id)))}
                        aria-label="Tout cocher"
                      />
                    </th>
                    <th>Code</th>
                    <th>Marchand</th>
                    <th>Ville</th>
                    <th>Livré le</th>
                    <th>COD</th>
                    <th>Frais transporteur</th>
                    <th>Attendu</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {creances.map((c) => (
                    <tr
                      key={c.id}
                      className={coches.has(c.id) ? s.ligneCochee : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setCoches((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={coches.has(c.id)}
                          onChange={() =>
                            setCoches((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            })
                          }
                          aria-label={`Cocher ${c.codeSuivi}`}
                        />
                      </td>
                      <td className={s.code}>
                        <CodeColis id={c.commandeId} code={c.codeSuivi} />
                      </td>
                      <td>{c.marchandNom ?? '—'}</td>
                      <td>{c.ville}</td>
                      <td>{new Date(c.dateLivraison).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{dh(c.montantCod)}</td>
                      <td>
                        {c.fraisTransporteur === null ? (
                          <span style={{ color: '#B85200', fontWeight: 700 }}>Tarif manquant</span>
                        ) : (
                          `− ${dh(c.fraisTransporteur)}`
                        )}
                      </td>
                      <td className={s.cod}>{dh(c.montantAttendu)}</td>
                      <td>
                        {c.enRetard ? (
                          <StatusPill label="En retard" grad={['#FC8500', '#E56A00']} />
                        ) : (
                          <StatusPill label="À recevoir" grad={['#8ECAE6', '#209EBB']} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {creances.length === 0 && <div className={s.vide}>Rien à recevoir de {choisi.nom}.</div>}
            </div>

            <div className={s.pied}>
              <span className={s.piedTexte}>
                {coches.size > 0
                  ? `${coches.size} colis · ${dh(attenduCoche)} attendus`
                  : 'Cochez les colis couverts par un versement'}
              </span>
              <button type="button" className={s.btnJaune} disabled={coches.size === 0} onClick={() => setFenetre({ mode: 'payer' })}>
                <BadgeCheck className="h-4 w-4" /> Marquer payé
              </button>
            </div>
          </section>

          {/* ===== Versements ===== */}
          <section className={`${s.card} ${s.panneau}`}>
            <h2 className={s.sectionTitre}>Versements de {choisi.nom}</h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Colis</th>
                    <th>Attendu</th>
                    <th>Reçu</th>
                    <th>Écart</th>
                    <th>Reçu bancaire</th>
                    <th>Saisi par</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {versements.map((v) => (
                    <tr key={v.id} style={v.annuleLe ? { opacity: 0.5 } : undefined}>
                      <td className={s.code}>n° {v.numero}</td>
                      <td>{new Date(v.dateVersement).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <span className={s.nbColis}>{v.nbColis}</span>
                      </td>
                      <td>{dh(v.montantAttendu)}</td>
                      <td className={s.cod}>{dh(v.montantRecu)}</td>
                      <td style={{ fontWeight: 700, color: v.ecart === 0 ? '#209EBB' : '#B85200' }}>
                        {v.ecart === 0 ? 'Aucun' : `${v.ecart > 0 ? '+' : ''}${dh(v.ecart)}`}
                      </td>
                      <td>
                        {v.preuve ? (
                          <a href={`/api/reglements-transporteurs/versements/${v.id}/preuve`} target="_blank" rel="noreferrer" style={{ color: '#209EBB', fontWeight: 700 }}>
                            Voir la photo
                          </a>
                        ) : (
                          <span style={{ color: '#8C8C86' }}>—</span>
                        )}
                      </td>
                      <td>
                        {v.auteur}
                        {v.note && <span className={s.dateSous}>{v.note}</span>}
                      </td>
                      <td>
                        {v.annuleLe ? (
                          <span className={s.dateSous}>Annulé{v.annulePar ? ` par ${v.annulePar}` : ''}</span>
                        ) : (
                          <span style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className={s.btnClair} style={{ padding: '6px 10px' }} onClick={() => setFenetre({ mode: 'modifier', versement: v })}>
                              <Pencil className="h-3.5 w-3.5" /> Modifier
                            </button>
                            <button type="button" className={s.btnClair} style={{ padding: '6px 10px' }} onClick={() => annuler(v)}>
                              <Undo2 className="h-3.5 w-3.5" /> Annuler
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {versements.length === 0 && <div className={s.vide}>Aucun versement enregistré.</div>}
            </div>
          </section>
        </>
      )}

      {fenetre && choisi && (
        <FenetreVersement
          titre={fenetre.mode === 'payer' ? `Marquer payé — ${choisi.nom}` : `Modifier le versement n° ${fenetre.versement.numero}`}
          initial={
            fenetre.mode === 'payer'
              ? { montant: attenduCoche.toFixed(2), date: aujourdhui(), note: '' }
              : {
                  montant: fenetre.versement.montantRecu.toFixed(2),
                  date: fenetre.versement.dateVersement.slice(0, 10),
                  note: fenetre.versement.note ?? '',
                }
          }
          attendu={fenetre.mode === 'payer' ? attenduCoche : fenetre.versement.montantAttendu}
          onFermer={() => setFenetre(null)}
          onValider={async ({ montant, date, note, preuve }) => {
            if (fenetre.mode === 'payer') {
              const v = await apiPost<{ numero: number; nbColis: number }>(`/api/reglements-transporteurs/${choisi.id}/versements`, {
                creanceIds: Array.from(coches),
                montantRecu: montant,
                dateVersement: date,
                note,
                preuve,
              });
              setFenetre(null);
              await rafraichir(`Versement n° ${v.numero} enregistré : ${v.nbColis} colis payés`);
            } else {
              await apiPatch(`/api/reglements-transporteurs/versements/${fenetre.versement.id}`, {
                montantRecu: montant,
                dateVersement: date,
                note,
                ...(preuve !== undefined && { preuve }),
              });
              setFenetre(null);
              await rafraichir(`Versement n° ${fenetre.versement.numero} modifié`);
            }
          }}
        />
      )}
    </main>
  );
}

function FenetreVersement({
  titre,
  initial,
  attendu,
  onFermer,
  onValider,
}: {
  titre: string;
  initial: { montant: string; date: string; note: string };
  attendu: number;
  onFermer: () => void;
  onValider: (v: { montant: string; date: string; note: string; preuve: string | undefined }) => Promise<void>;
}) {
  const [montant, setMontant] = useState(initial.montant);
  const [date, setDate] = useState(initial.date);
  const [note, setNote] = useState(initial.note);
  const [preuve, setPreuve] = useState<string | undefined>(undefined);
  const [nomPhoto, setNomPhoto] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const ecart = Number(montant || 0) - attendu;

  return (
    <Modal title={titre} onClose={onFermer}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnCours(true);
          setErreur(null);
          try {
            await onValider({ montant, date, note, preuve });
          } catch (err) {
            setErreur(err instanceof Error ? err.message : 'Erreur');
          } finally {
            setEnCours(false);
          }
        }}
      >
        <p className="opacity-70">Attendu : {dh(attendu)}</p>
        <label className="flex flex-col gap-1 font-semibold">
          Montant reçu (DH)
          <input className="input-basic" type="number" step="0.01" min="0.01" value={montant} onChange={(e) => setMontant(e.target.value)} required />
        </label>
        {Math.abs(ecart) >= 0.01 && (
          <p style={{ color: '#B85200', fontWeight: 600 }}>
            Écart de {ecart > 0 ? '+' : ''}
            {dh(ecart)} avec l&apos;attendu : il sera enregistré sur le versement.
          </p>
        )}
        <label className="flex flex-col gap-1 font-semibold">
          Date du versement
          <input className="input-basic" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Note (facultative)
          <input className="input-basic" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Référence du virement, remarque…" />
        </label>
        <label className="btn-outline flex w-fit cursor-pointer items-center gap-1.5">
          <Camera className="h-4 w-4" /> {nomPhoto ?? 'Photo du reçu bancaire (facultative)'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setPreuve(await lireFichier(f));
              setNomPhoto(f.name);
            }}
          />
        </label>
        {erreur && <p className="font-medium text-red-600">{erreur}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onFermer} disabled={enCours}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
