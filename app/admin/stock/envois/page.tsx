'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageOpen } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { CodeColis } from '@/components/colis/CodeColis';

interface LigneEnvoi {
  id: string;
  sku: string;
  quantiteAnnoncee: number;
  quantiteRecue: number;
  produit: { id: string; nom: string; marchand: { nomBoutique: string } | null };
  variante: { nom: string } | null;
}

interface Envoi {
  id: string;
  reference: string;
  environnement: 'test' | 'live';
  statut: 'attendu' | 'recu_partiel' | 'recu';
  dateAnnonce: string;
  dateReception: string | null;
  plateforme: { nom: string };
  lignes: LigneEnvoi[];
}

interface ColisEnAttente {
  id: string;
  codeSuivi: string;
  codeSuiviPartenaire: string | null;
  dateCreation: string;
  marchand: { nomBoutique: string };
  lignes: { id: string; sku: string | null; libelle: string; quantite: number; provenance: string | null; disponible: number | null }[];
}

const STATUTS: Record<Envoi['statut'], { libelle: string; classe: string }> = {
  attendu: { libelle: 'Attendu', classe: 'badge-neutral' },
  recu_partiel: { libelle: 'Reçu en partie', classe: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  recu: { libelle: 'Reçu', classe: 'bg-green-500/15 text-green-700 dark:text-green-400' },
};

// § Envois de stock (12/10/2026) : ce que les plateformes partenaires
// annoncent envoyer à l'entrepôt (POST /api/v1/stock/envois). L'entrepôt
// saisit ici ce qu'il a compté, ligne par ligne ; la réception depuis la fiche
// produit impute aussi ses unités à ces envois (lib/stock-reception.ts).
export default function EnvoisStockPage() {
  const [envois, setEnvois] = useState<Envoi[]>([]);
  const [enAttente, setEnAttente] = useState<ColisEnAttente[]>([]);
  const [tous, setTous] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(afficherTous = tous) {
    setChargement(true);
    try {
      const [res, attente] = await Promise.all([
        apiGet<{ data: Envoi[] }>(`/api/stock/envois${afficherTous ? '?statut=tous' : ''}`),
        apiGet<{ data: ColisEnAttente[] }>('/api/stock/envois/colis-en-attente'),
      ]);
      setEnvois(res.data);
      setEnAttente(attente.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Envois de stock</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tous}
            onChange={(e) => {
              setTous(e.target.checked);
              load(e.target.checked);
            }}
          />
          Afficher aussi les envois reçus
        </label>
      </div>
      <p className="text-sm opacity-60">
        Arrivages annoncés par les plateformes partenaires. Saisissez ce que vous avez compté : le stock devient
        disponible et les colis qui l’attendaient sont servis.
      </p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {enAttente.length > 0 && <ColisEnAttenteStock colis={enAttente} />}

      {!chargement && envois.length === 0 && (
        <div className="table-card">
          <div className="empty-state">
            <PackageOpen className="h-8 w-8 opacity-40" />
            <p className="font-medium">{tous ? 'Aucun envoi annoncé' : 'Aucun envoi en attente de réception'}</p>
          </div>
        </div>
      )}

      {envois.map((envoi) => (
        <CarteEnvoi key={envoi.id} envoi={envoi} onRecu={() => load()} />
      ))}
    </div>
  );
}

function CarteEnvoi({ envoi, onRecu }: { envoi: Envoi; onRecu: () => void }) {
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ouvert = envoi.statut !== 'recu';
  const statut = STATUTS[envoi.statut];

  function toutRecevoir() {
    setSaisies(Object.fromEntries(envoi.lignes.map((l) => [l.id, String(l.quantiteAnnoncee - l.quantiteRecue)])));
  }

  async function valider() {
    const lignes = Object.entries(saisies)
      .map(([ligneId, v]) => ({ ligneId, quantite: Number(v) }))
      .filter((l) => l.quantite > 0);
    if (lignes.length === 0) {
      setError('Saisissez au moins une quantité reçue');
      return;
    }
    setError(null);
    setEnvoiEnCours(true);
    try {
      await apiPost(`/api/stock/envois/${envoi.id}/reception`, { lignes });
      setSaisies({});
      onRecu();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <div className="table-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{envoi.reference}</span>
          <span className="opacity-60">{envoi.plateforme.nom}</span>
          {envoi.environnement === 'test' && <span className="badge badge-neutral">Bac à sable</span>}
          <span className={`badge ${statut.classe}`}>{statut.libelle}</span>
        </div>
        <span className="text-xs opacity-60">
          Annoncé le {new Date(envoi.dateAnnonce).toLocaleString('fr-FR')}
          {envoi.dateReception && ` · reçu le ${new Date(envoi.dateReception).toLocaleString('fr-FR')}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Produit</th>
              <th>Stock de</th>
              <th className="text-right">Annoncé</th>
              <th className="text-right">Reçu</th>
              {ouvert && <th className="w-32">Compté</th>}
            </tr>
          </thead>
          <tbody>
            {envoi.lignes.map((l) => {
              const reste = l.quantiteAnnoncee - l.quantiteRecue;
              return (
                <tr key={l.id}>
                  <td className="font-mono text-xs">{l.sku}</td>
                  <td>
                    <Link href={`/admin/stock/inventaire/${l.produit.id}`} className="hover:underline">
                      {l.variante ? `${l.produit.nom} — ${l.variante.nom}` : l.produit.nom}
                    </Link>
                  </td>
                  <td className="text-xs">{l.produit.marchand?.nomBoutique ?? `Stock commun ${envoi.plateforme.nom}`}</td>
                  <td className="text-right">{l.quantiteAnnoncee}</td>
                  <td className={`text-right ${reste > 0 && l.quantiteRecue > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>
                    {l.quantiteRecue}
                  </td>
                  {ouvert && (
                    <td>
                      {reste > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={reste}
                          className="input-basic w-24 py-1"
                          placeholder={`≤ ${reste}`}
                          value={saisies[l.id] ?? ''}
                          onChange={(e) => setSaisies((s) => ({ ...s, [l.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="text-xs opacity-50">Complet</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ouvert && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-black/10 px-3 py-2 dark:border-white/10">
          {error && <p className="mr-auto text-sm font-medium text-red-600">{error}</p>}
          <button type="button" className="btn-outline" onClick={toutRecevoir} disabled={envoiEnCours}>
            Tout reçu
          </button>
          <button type="button" className="btn-primary" onClick={valider} disabled={envoiEnCours}>
            {envoiEnCours ? 'Validation…' : 'Valider la réception'}
          </button>
        </div>
      )}
    </div>
  );
}

// Colis acceptés sans stock suffisant : servis automatiquement, dans cet
// ordre, dès qu'une réception couvre tout leur contenu.
function ColisEnAttenteStock({ colis }: { colis: ColisEnAttente[] }) {
  return (
    <div className="table-card border-amber-500/40">
      <div className="border-b border-black/10 bg-amber-500/10 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          {colis.length} colis en attente de stock
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[720px]">
          <thead>
            <tr>
              <th>Colis</th>
              <th>Vendeur</th>
              <th>Reçu le</th>
              <th>Contenu (demandé / disponible)</th>
            </tr>
          </thead>
          <tbody>
            {colis.map((c) => (
              <tr key={c.id}>
                <td>
                  <CodeColis id={c.id} code={c.codeSuivi} className="text-xs font-semibold" />
                  {c.codeSuiviPartenaire && <span className="block text-xs opacity-60">{c.codeSuiviPartenaire}</span>}
                </td>
                <td>{c.marchand.nomBoutique}</td>
                <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                <td>
                  <div className="flex flex-col gap-0.5 py-1 text-xs">
                    {c.lignes.map((l) => {
                      const manque = l.disponible !== null && l.disponible < l.quantite;
                      return (
                        <span key={l.id} className={manque ? 'font-semibold text-amber-700 dark:text-amber-400' : undefined}>
                          <span className="font-mono">{l.sku ?? '—'}</span> {l.libelle} : {l.quantite} / {l.disponible ?? '—'}
                          {l.provenance === 'stock_plateforme' && <span className="opacity-60"> (stock commun)</span>}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
