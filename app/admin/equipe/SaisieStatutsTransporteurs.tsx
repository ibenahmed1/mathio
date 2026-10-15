'use client';

import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';

// § Saisie des statuts par les transporteurs (15/10/2026) : un interrupteur
// par transporteur, sous les rôles. Coupé, son compte voit toujours ses bons
// et ses colis mais ne peut plus les déclarer Livré / Reporté / Non livré —
// c'est le cas normal d'un transporteur dont l'API nous renvoie les statuts.
// On le rouvre le temps d'une panne de cette API. Le refus est appliqué par
// le serveur (PATCH /api/livreur/colis/[id]/statut), pas seulement à l'écran.

interface TransporteurSaisie {
  id: string;
  nom: string;
  actif: boolean;
  saisieStatutsActive: boolean;
  compteLivreur: { id: string; nomComplet: string } | null;
}

export function SaisieStatutsTransporteurs() {
  const [transporteurs, setTransporteurs] = useState<TransporteurSaisie[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: TransporteurSaisie[] }>('/api/prestataires')
      .then((res) => setTransporteurs(res.data.filter((p) => p.actif)))
      .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  async function basculer(t: TransporteurSaisie) {
    setErreur(null);
    setEnCours(t.id);
    try {
      await apiPatch(`/api/prestataires/${t.id}`, { saisieStatutsActive: !t.saisieStatutsActive });
      setTransporteurs((liste) =>
        (liste ?? []).map((p) => (p.id === t.id ? { ...p, saisieStatutsActive: !t.saisieStatutsActive } : p))
      );
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-4 shadow-[var(--mk-shadow)]">
      <div>
        <p className="flex items-center gap-2 text-[15px] font-black">
          <Truck className="h-4 w-4" /> Transporteurs — saisie des statuts
        </p>
        <p className="mt-1 max-w-2xl text-xs text-black/55 dark:text-white/55">
          Activé : le transporteur déclare lui-même l’issue de ses colis (Livré, Reporté, Non livré) depuis son espace.
          Désactivé : il consulte ses bons et ses colis, et ses statuts nous arrivent par son API. Activez-le le temps
          d’une panne de son API.
        </p>
      </div>

      {erreur && <p className="form-error">{erreur}</p>}

      {transporteurs === null && !erreur && <p className="text-sm opacity-60">Chargement…</p>}

      {transporteurs && (
        <div className="table-card">
          <div className="table-scroll">
            <table className="table-basic min-w-[560px]">
              <thead>
                <tr>
                  <th>Transporteur</th>
                  <th>Compte rattaché</th>
                  <th>Saisie des statuts</th>
                </tr>
              </thead>
              <tbody>
                {transporteurs.map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.nom}</td>
                    <td className="text-sm">
                      {t.compteLivreur ? t.compteLivreur.nomComplet : <span className="opacity-50">Aucun compte</span>}
                    </td>
                    <td>
                      <label className="inline-flex cursor-pointer items-center gap-2.5">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={t.saisieStatutsActive}
                          aria-label={`Saisie des statuts pour ${t.nom}`}
                          disabled={enCours === t.id}
                          onClick={() => basculer(t)}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                            t.saisieStatutsActive ? 'bg-emerald-500' : 'bg-black/20 dark:bg-white/20'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                              t.saisieStatutsActive ? 'left-[22px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                        <span className={`text-xs font-semibold ${t.saisieStatutsActive ? 'text-emerald-700 dark:text-emerald-400' : 'opacity-60'}`}>
                          {t.saisieStatutsActive ? 'Activée' : 'Désactivée'}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
                {transporteurs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center opacity-60">
                      Aucun transporteur actif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
