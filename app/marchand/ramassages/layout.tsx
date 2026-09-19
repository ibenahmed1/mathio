import { VerrouProfil } from '@/components/marchand/VerrouProfil';

// § Inscription progressive : cette section n'est ouverte qu'aux dossiers
// complets ET validés (cf. lib/marchand-activation.ts). Le verrou est posé
// dans un layout plutôt que dans chaque page — toute page ajoutée ici en
// hérite, y compris les sous-écrans, sans qu'on ait à y penser.
//
// Ce n'est qu'un affichage : le refus qui compte est celui des routes API et
// de la Server Action de génération (exigerMarchandOperationnel).
export default function VerrouSectionLayout({ children }: { children: React.ReactNode }) {
  return <VerrouProfil>{children}</VerrouProfil>;
}
