'use client';

import { useState } from 'react';
import { ClientsAFacturer } from '@/components/factures/ClientsAFacturer';
import { FactureEditeur } from '@/components/factures/FactureEditeur';
import type { MarchandAFacturer } from '@/lib/types';

// § /admin/factures/nouvelle — les deux étapes de la création d'une facture.
//
// Étape 1 : « Clients à facturer », la liste des marchands qui ont de la
// matière. Étape 2 : la composition proprement dite, colis pré-cochés.
//
// L'étape courante vit dans l'état local et non dans l'URL : le retour à la
// liste est un bouton explicite en haut de l'écran, et une étape 2 adressable
// n'apporterait rien qu'un rechargement ne referait — l'assiette facturable
// change d'heure en heure. La reprise d'un brouillon, elle, a bien une URL
// stable (§ /admin/factures/[id]/modifier) : c'est un document qui existe.
export default function NouvelleFacturePage() {
  const [marchand, setMarchand] = useState<MarchandAFacturer | null>(null);

  if (marchand) {
    return (
      <FactureEditeur
        marchandId={marchand.marchandId}
        onRetour={() => setMarchand(null)}
        retourLabel="Choisir un autre client"
      />
    );
  }

  return <ClientsAFacturer onChoisir={setMarchand} />;
}
