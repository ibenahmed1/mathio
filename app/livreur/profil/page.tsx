'use client';

import { useEffect, useState } from 'react';
import { Building2, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { ROLE_LABELS } from '@/components/admin/AdminSidebar';
import type { Role } from '@/app/generated/prisma/enums';

// § /livreur/profil — destination du « Profil » du menu de la barre latérale
// (cf. LivreurShell, qui la lui passe en prop). L'écran est en LECTURE SEULE :
// un livreur ne modifie ni son rattachement à un hub ni son rôle, et son mot
// de passe se réinitialise depuis l'écran de connexion, par le même parcours
// que tous les autres comptes. Sans cette page, l'entrée du menu ne menait
// nulle part.

interface MonCompte {
  id: string;
  nomComplet: string;
  telephone: string | null;
  email: string | null;
  role: Role;
  hub: { id: string; nom: string } | null;
}

function Ligne({
  icone: Icone,
  libelle,
  valeur,
}: {
  icone: React.ComponentType<{ className?: string }>;
  libelle: string;
  valeur: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-black/[0.05] py-3 last:border-b-0 dark:border-white/[0.06]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink dark:bg-brand/10 dark:text-brand">
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{libelle}</p>
        <p className="font-semibold [overflow-wrap:anywhere]">{valeur}</p>
      </div>
    </div>
  );
}

export default function ProfilLivreurPage() {
  const [compte, setCompte] = useState<MonCompte | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      apiGet<MonCompte>('/api/auth/me')
        .then(setCompte)
        .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
    });
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mon profil</h1>
          <p className="page-subtitle">
            Ces informations sont tenues par l&apos;administration. Pour en corriger une, passez par votre
            responsable de hub.
          </p>
        </div>
      </div>

      {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

      {compte && (
        <div className="dashboard-card max-w-xl">
          <Ligne icone={UserRound} libelle="Nom" valeur={compte.nomComplet} />
          <Ligne icone={ShieldCheck} libelle="Rôle" valeur={ROLE_LABELS[compte.role]} />
          <Ligne icone={Phone} libelle="Téléphone" valeur={compte.telephone ?? '—'} />
          <Ligne icone={Mail} libelle="Email" valeur={compte.email ?? '—'} />
          <Ligne icone={Building2} libelle="Hub de rattachement" valeur={compte.hub?.nom ?? '—'} />
        </div>
      )}
    </div>
  );
}
