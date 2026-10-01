'use client';

import ComptabiliteBoard from '@/components/accounting/ComptabiliteBoard';
import { usePermissionsMarchand } from '@/components/marchand/permissions-context';

// § Comptabilité de la boutique — le même écran que /admin/comptabilite :
// trésorerie, commandes d'inventaire, journal des transactions, fiche d'une
// écriture, catégories, corbeille et historique. Les routes appelées sont
// celles du back-office ; c'est le serveur qui cantonne lecture et écriture
// aux livres de CETTE boutique (lib/comptabilite-perimetre.ts).
//
// Pas de verrou d'activation (VerrouProfil) : ce carnet ne dépend d'aucune
// validation du dossier par la plateforme.
export default function ComptabiliteMarchandPage() {
  const { peut } = usePermissionsMarchand();

  return (
    <div className="flex flex-col gap-4">
      <ComptabiliteBoard
        espace="marchand"
        peutSaisir={peut('comptabilite.saisir')}
        peutModifier={peut('comptabilite.modifier')}
        peutSupprimer={peut('comptabilite.supprimer')}
      />
    </div>
  );
}
