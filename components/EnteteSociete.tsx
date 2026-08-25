import type { ReactNode } from 'react';
import type { ParametresSociete } from '@/lib/societe';

// Bloc d'identité imprimé en haut à droite de tous les documents sortants
// (§ /admin/parametres). Les six pages d'impression écrivaient auparavant
// « Mathio Delivery » en dur, chacune de son côté.
//
// Les paramètres sont passés en propriété plutôt que lus ici : la page les
// charge de toute façon pour son bloc de signature, et un composant qui
// requêterait pour son compte ferait deux allers-retours par document.
//
// `children` reçoit ce qui est propre au document — le hub concerné, le
// tampon « Réglé le … » — et reste donc aligné à droite avec le reste.
export function EnteteSociete({
  societe,
  children,
}: {
  societe: ParametresSociete;
  children?: ReactNode;
}) {
  return (
    <div className="text-right text-sm">
      {societe.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, pas d'optimisation possible ni souhaitable sur une page d'impression
        <img src={societe.logoUrl} alt="" className="ml-auto mb-1 h-10 w-auto object-contain" />
      )}
      <p className="font-bold">{societe.raisonSociale}</p>
      {societe.adresse && <p className="text-xs">{societe.adresse}</p>}
      {societe.telephone && <p className="text-xs">Tél. {societe.telephone}</p>}
      {societe.email && <p className="text-xs">{societe.email}</p>}
      {societe.siteWeb && <p className="text-xs">{societe.siteWeb}</p>}
      {children}
    </div>
  );
}
