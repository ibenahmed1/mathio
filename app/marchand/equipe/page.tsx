'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MailCheck, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { PageTabs } from '@/components/PageTabs';
import type { DonneesEquipe } from './equipe-types';
import { Kpi } from './equipe-ui';
import { AjouterMembreModal } from './equipe-modales';
import { OngletMembres } from './OngletMembres';
import { OngletRoles } from './OngletRoles';
import { OngletJournal } from './OngletJournal';

// § Équipe & accès — la gestion de l'équipe d'une boutique : membres (ajout
// manuel ou invitation par email), rôles prédéfinis et personnalisés, journal.
//
// Page ouverte par `equipe.voir` (proxy, PAGES_MARCHAND) ; chaque geste
// d'écriture exige `equipe.gerer` et les règles de lib/equipe-marchand.ts.
// Les onglets vivent dans l'URL (`?onglet=roles`) : un lien partagé ou un
// retour arrière ramène sur le bon.
type Onglet = 'membres' | 'roles' | 'journal';

function EquipeContenu() {
  const params = useSearchParams();
  const onglet: Onglet = params.get('onglet') === 'roles' ? 'roles' : params.get('onglet') === 'journal' ? 'journal' : 'membres';
  const [donnees, setDonnees] = useState<DonneesEquipe | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  // Incrémenté à chaque geste : l'onglet Journal se recharge avec lui.
  const [version, setVersion] = useState(0);

  const charger = useCallback(async () => {
    try {
      setDonnees(await apiGet<DonneesEquipe>('/api/marchands/equipe'));
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

  const peutGerer = donnees?.moi.permissions.includes('equipe.gerer') ?? false;
  const membres = donnees?.membres ?? [];
  // Compteurs sur les seuls MEMBRES : le titulaire a sa propre ligne,
  // épinglée, et les filtres de l'onglet ne le comptent pas non plus.
  const nbActifs = membres.filter((m) => m.statut === 'actif').length;
  const nbInvitations = membres.filter((m) => m.statut === 'invitation' || m.statut === 'invitation_expiree').length;
  const nbBloques = membres.filter((m) => m.statut === 'suspendu' || m.statut === 'expire').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="page-header mb-0">
        <div className="min-w-0">
          <h1 className="page-title">Équipe &amp; accès</h1>
          <p className="page-subtitle">
            Qui accède à {donnees ? <strong>{donnees.boutique.nom}</strong> : 'votre boutique'}, et ce que chacun peut y
            faire.
          </p>
        </div>
        {peutGerer && donnees && (
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setAjout(true)}>
            <UserPlus className="h-4 w-4" /> Ajouter un membre
          </button>
        )}
      </div>

      {erreur && <p className="form-error">{erreur}</p>}

      {!donnees ? (
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
              label="Invitations"
              valeur={nbInvitations}
              icone={<MailCheck className="h-5 w-5" />}
              accent="bg-brand/25 text-brand-ink dark:text-brand"
            />
            <Kpi
              label="Accès coupés"
              valeur={nbBloques}
              icone={<UserX className="h-5 w-5" />}
              accent="bg-red-500/15 text-red-700 dark:text-red-400"
            />
            <Kpi label="Rôles" valeur={donnees.roles.length} icone={<ShieldCheck className="h-5 w-5" />} />
          </div>

          {!peutGerer && (
            <p className="rounded-xl border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] px-4 py-3 text-[13px] text-[color:var(--mk-ink-2)]">
              Consultation seule : votre rôle vous permet de voir l’équipe, pas de la modifier.
            </p>
          )}

          <PageTabs
            activeHref={onglet === 'membres' ? '/marchand/equipe' : `/marchand/equipe?onglet=${onglet}`}
            tabs={[
              { label: `Membres (${membres.length})`, href: '/marchand/equipe' },
              { label: `Rôles & permissions (${donnees.roles.length})`, href: '/marchand/equipe?onglet=roles' },
              { label: 'Journal', href: '/marchand/equipe?onglet=journal' },
            ]}
          />

          {onglet === 'membres' && <OngletMembres donnees={donnees} recharger={recharger} />}
          {onglet === 'roles' && <OngletRoles donnees={donnees} recharger={recharger} />}
          {onglet === 'journal' && <OngletJournal key={version} />}
        </>
      )}

      {ajout && donnees && <AjouterMembreModal donnees={donnees} onClose={() => setAjout(false)} onFait={recharger} />}
    </div>
  );
}

export default function MarchandEquipePage() {
  return (
    <Suspense fallback={<p className="opacity-60">Chargement…</p>}>
      <EquipeContenu />
    </Suspense>
  );
}
