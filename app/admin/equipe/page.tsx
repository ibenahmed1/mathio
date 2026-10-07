'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, Truck, UserCheck, UserPlus, UserX } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Utilisateur } from '@/lib/types';
import { PageTabs } from '@/components/PageTabs';
import { UserFormModal, type UserFormMode } from '@/components/admin/UserFormModal';
import { estFonctionTerrain } from '@/lib/fonctions-equipe';
import type { RoleBackofficeExpose } from '@/lib/roles-backoffice';
import { Kpi } from '@/app/marchand/equipe/equipe-ui';
import { OngletMembresAdmin, type Moi } from './OngletMembresAdmin';
import { OngletFonctions } from './OngletFonctions';
import { OngletJournalEquipe } from './OngletJournalEquipe';

// § Équipe & rôles — l'équipe interne : membres, fonctions et leurs droits,
// journal des gestes d'administration.
//
// Construit à L'IDENTIQUE de l'écran Équipe & accès du marchand
// (app/marchand/equipe) : mêmes onglets, mêmes tuiles, mêmes cartes. La classe
// `marchand-typo` apporte sa police et ses jetons --mk-* (cartes, filets,
// ombres) ; le fond, lui, reste celui de l'administration — `marchand-surface`
// n'est volontairement pas posée.
//
// Les onglets vivent dans l'URL (`?onglet=roles`) : un lien partagé ou un
// retour arrière ramène sur le bon.
type Onglet = 'membres' | 'roles' | 'journal';

function EquipeContenu() {
  const params = useSearchParams();
  const onglet: Onglet = params.get('onglet') === 'roles' ? 'roles' : params.get('onglet') === 'journal' ? 'journal' : 'membres';
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[] | null>(null);
  const [roles, setRoles] = useState<RoleBackofficeExpose[]>([]);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<UserFormMode | null>(null);
  // Incrémenté à chaque geste : l'onglet Journal se recharge avec lui.
  const [version, setVersion] = useState(0);

  const charger = useCallback(async () => {
    try {
      // Les rôles d'abord : leur lecture crée les prédéfinis et y rattache les
      // comptes qui n'en ont pas encore, que la liste des membres reflète alors.
      const lesRoles = await apiGet<{ data: RoleBackofficeExpose[] }>('/api/utilisateurs/roles');
      const [liste, compte] = await Promise.all([
        apiGet<{ data: Utilisateur[] }>('/api/utilisateurs'),
        apiGet<Moi>('/api/auth/me').catch(() => null),
      ]);
      setRoles(lesRoles.data);
      setUtilisateurs(liste.data);
      setMoi(compte);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    }
  }, []);

  const recharger = useCallback(() => {
    setVersion((v) => v + 1);
    void charger();
  }, [charger]);

  useEffect(() => {
    Promise.resolve().then(() => charger());
  }, [charger]);

  const membres = utilisateurs ?? [];
  const nbActifs = membres.filter((u) => u.actif).length;
  const nbTerrain = membres.filter((u) => estFonctionTerrain(u.role)).length;
  const nbBloques = membres.length - nbActifs;

  return (
    <div className="marchand-typo flex flex-col gap-5">
      <div className="page-header mb-0">
        <div className="min-w-0">
          <h1 className="page-title">Équipe &amp; rôles</h1>
          <p className="page-subtitle">Qui accède au back-office et au terrain, et ce que chacun peut y faire.</p>
        </div>
        {utilisateurs && (
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setFormMode({ kind: 'create' })}>
            <UserPlus className="h-4 w-4" /> Ajouter un membre
          </button>
        )}
      </div>

      {erreur && <p className="form-error">{erreur}</p>}

      {!utilisateurs ? (
        !erreur && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-black/[0.05] dark:bg-white/[0.06]" />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Membres actifs"
              valeur={nbActifs}
              icone={<UserCheck className="h-5 w-5" />}
              accent="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            />
            <Kpi
              label="Terrain"
              valeur={nbTerrain}
              icone={<Truck className="h-5 w-5" />}
              accent="bg-brand/25 text-brand-ink dark:text-brand"
            />
            <Kpi
              label="Accès coupés"
              valeur={nbBloques}
              icone={<UserX className="h-5 w-5" />}
              accent="bg-red-500/15 text-red-700 dark:text-red-400"
            />
            <Kpi label="Rôles" valeur={roles.length} icone={<ShieldCheck className="h-5 w-5" />} />
          </div>

          <PageTabs
            activeHref={onglet === 'membres' ? '/admin/equipe' : `/admin/equipe?onglet=${onglet}`}
            tabs={[
              { label: `Membres (${membres.length})`, href: '/admin/equipe' },
              { label: `Rôles & permissions (${roles.length})`, href: '/admin/equipe?onglet=roles' },
              { label: 'Journal', href: '/admin/equipe?onglet=journal' },
            ]}
          />

          {onglet === 'membres' && (
            <OngletMembresAdmin membres={membres} roles={roles} moi={moi} recharger={recharger} onModifier={setFormMode} />
          )}
          {onglet === 'roles' && <OngletFonctions roles={roles} recharger={recharger} />}
          {onglet === 'journal' && <OngletJournalEquipe key={version} />}
        </>
      )}

      {formMode && (
        <UserFormModal
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            recharger();
          }}
        />
      )}
    </div>
  );
}

export default function AdminEquipePage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <EquipeContenu />
    </Suspense>
  );
}
