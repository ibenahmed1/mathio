'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FactureEditeur } from '@/components/factures/FactureEditeur';
import { apiGet } from '@/lib/api-client';
import type { Facture } from '@/lib/types';

// § /admin/factures/[id]/modifier — reprise d'un BROUILLON.
//
// Même éditeur que la création : composer une facture neuve et corriger un
// brouillon sont le même geste sur les mêmes données. Seule la source de la
// sélection initiale change — les lignes déjà enregistrées plutôt que toute
// l'assiette facturable.
//
// Une facture arrêtée n'est pas modifiable : l'écran renvoie alors vers son
// document plutôt que d'afficher un éditeur qui échouerait à l'enregistrement.
export default function ModifierFacturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [facture, setFacture] = useState<Facture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Facture>(`/api/factures/${id}`)
      .then((res) => {
        if (res.statut !== 'brouillon') {
          router.replace(`/factures/${res.id}`);
          return;
        }
        setFacture(res);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [id, router]);

  if (error) return <p className="text-sm font-medium text-red-600">{error}</p>;
  if (!facture) return <p className="opacity-60">Chargement du brouillon…</p>;

  return (
    <FactureEditeur
      marchandId={facture.marchandId}
      factureExistante={facture}
      onRetour={() => router.push('/admin/factures/toutes')}
      retourLabel="Retour aux factures"
    />
  );
}
