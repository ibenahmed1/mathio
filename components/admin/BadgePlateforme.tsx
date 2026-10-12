import type { Commande } from '@/lib/types';

// § Plateformes partenaires : un colis déposé par une plateforme (Shipeh)
// porte son nom, et « en attente de stock » s'il a été accepté sans stock
// suffisant (§ stock commun, 12/10/2026).
export function BadgePlateforme({ commande }: { commande: Commande }) {
  if (commande.source !== 'api') return null;
  const nom = commande.marchand?.comptesExternes?.[0]?.plateforme?.nom ?? 'Plateforme';
  return (
    <>
      <span className="badge ml-2 bg-brand/10 text-brand" title={commande.codeSuiviPartenaire ?? undefined}>
        {nom}
      </span>
      {commande.enAttenteStock && (
        <span className="badge badge-warn ml-1" title="Servi automatiquement à la prochaine réception de stock">
          en attente de stock
        </span>
      )}
    </>
  );
}

export const OPTIONS_ORIGINE = [
  { value: '', label: 'Origine (toutes)' },
  { value: 'api', label: 'Colis des plateformes (Shipeh)' },
  { value: 'hors_api', label: 'Autres colis' },
];
