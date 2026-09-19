'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Plug, Plus, RefreshCw } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { ListePlateformes } from '@/components/admin/integrations/ListePlateformes';
import { PanneauDetail } from '@/components/admin/integrations/PanneauDetail';
import { ModalePartenaire } from '@/components/admin/integrations/ModalePartenaire';
import { ModaleCle } from '@/components/admin/integrations/ModaleCle';
import { ModaleCleEmise } from '@/components/admin/integrations/ModaleCleEmise';
import type { PlateformeDetail, PlateformeResume } from '@/lib/types';

// Intégrations partenaires (§ lib/plateformes.ts).
//
// Cette page ne porte plus que l'état partagé et l'aiguillage des fenêtres :
// la liste, le détail et les formulaires vivent dans
// components/admin/integrations/. Le fichier unique de neuf cents lignes
// rendait illisible ce qui est en réalité simple — une liste, un détail, trois
// modales.

export default function IntegrationsPage() {
  const [plateformes, setPlateformes] = useState<PlateformeResume[]>([]);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlateformeDetail | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [modale, setModale] = useState<'creation' | 'edition' | 'cle' | null>(null);
  // Valeur complète d'une clé fraîchement émise. Elle ne vit que dans cet état
  // React : elle n'est nulle part en base, et la page ne saura pas la
  // réafficher après un rechargement. C'est le sens même de la manœuvre.
  const [cleEmise, setCleEmise] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const liste = await apiGet<PlateformeResume[]>('/api/plateformes');
      setPlateformes(liste);
      // La sélection courante peut avoir disparu (suppression) : on retombe
      // alors sur la première de la liste plutôt que de garder un identifiant
      // mort qui ferait échouer le chargement du détail.
      setSelectionId((courant) =>
        courant && liste.some((p) => p.id === courant) ? courant : (liste[0]?.id ?? null)
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerDetail = useCallback(async (id: string) => {
    try {
      setDetail(await apiGet<PlateformeDetail>(`/api/plateformes/${id}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    }
  }, []);

  // Chargement différé d'un tour de boucle (`Promise.resolve().then`), comme
  // les autres écrans du back-office : appeler `charger()` dans le corps même
  // de l'effet y déclenche un setState synchrone, donc un rendu en cascade
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    Promise.resolve().then(() => charger());
  }, [charger]);

  useEffect(() => {
    Promise.resolve().then(() => {
      if (selectionId) return chargerDetail(selectionId);
      setDetail(null);
    });
  }, [selectionId, chargerDetail]);

  async function rafraichir() {
    await charger();
    if (selectionId) await chargerDetail(selectionId);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Intégrations partenaires</h1>
          <p className="page-subtitle">
            Les canaux de vente qui nous envoient leurs marchands et leurs colis, les transporteurs
            qui nous en déclarent l’issue, et les clés d’API qui les authentifient.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn-outline btn-sm" onClick={() => void rafraichir()}>
            <RefreshCw size={15} /> Rafraîchir
          </button>
          <button className="btn-primary btn-sm" onClick={() => setModale('creation')}>
            <Plus size={15} /> Nouveau partenaire
          </button>
        </div>
      </div>

      {erreur && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle size={16} /> {erreur}
        </div>
      )}

      {chargement ? (
        <div className="empty-state">Chargement…</div>
      ) : plateformes.length === 0 ? (
        <div className="table-card">
          <div className="empty-state">
            <Plug size={28} className="opacity-40" />
            <p className="font-semibold">Aucun partenaire</p>
            <p>
              Un partenaire est soit un canal de vente qui nous envoie ses marchands et ses colis,
              soit un transporteur qui nous déclare l’issue de ceux qu’on lui confie. L’API ne
              répond qu’à des clés émises depuis cet écran.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <ListePlateformes
            plateformes={plateformes}
            selectionId={selectionId}
            onSelect={setSelectionId}
          />

          {detail && (
            <PanneauDetail
              detail={detail}
              onNouvelleCle={() => setModale('cle')}
              onModifier={() => setModale('edition')}
              onChange={() => void rafraichir()}
              onSupprime={() => {
                // La sélection tombe avant le rechargement : garder l'ancien
                // identifiant ferait demander le détail d'une plateforme qui
                // n'existe plus, donc afficher un 404 en guise de confirmation.
                setSelectionId(null);
                setDetail(null);
                void charger();
              }}
            />
          )}
        </div>
      )}

      {modale === 'creation' && (
        <ModalePartenaire
          onClose={() => setModale(null)}
          onEnregistre={(creee) => {
            setModale(null);
            setSelectionId(creee.id);
            void charger();
          }}
        />
      )}

      {modale === 'edition' && detail && (
        <ModalePartenaire
          existant={detail}
          onClose={() => setModale(null)}
          onEnregistre={() => {
            setModale(null);
            void rafraichir();
          }}
        />
      )}

      {modale === 'cle' && detail && (
        <ModaleCle
          plateforme={detail}
          onClose={() => setModale(null)}
          onCreee={(complete) => {
            setModale(null);
            setCleEmise(complete);
            void rafraichir();
          }}
        />
      )}

      {cleEmise && <ModaleCleEmise cle={cleEmise} onClose={() => setCleEmise(null)} />}
    </div>
  );
}
