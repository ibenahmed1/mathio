import { redirect } from "next/navigation";
import ComptabiliteBoard from "@/components/accounting/ComptabiliteBoard";
import a from "@/components/accounting/Accounting.module.css";
import { getPageSession } from "@/lib/auth";

export const metadata = { title: "Comptabilité — Mathio Delivery" };

// § RBAC comptabilité : réservé à admin + responsable (cf.
// ROLES_COMPTABILITE dans app/api/finance/route.ts et components/admin/nav.ts).
// Vérifié ici en plus du filtrage de nav — le layout admin ne garde que
// l'appartenance à l'espace admin au sens large, pas cette restriction fine.
const ROLES_COMPTABILITE = ["admin", "responsable"];

export default async function ComptabiliteAdminPage() {
  const session = await getPageSession("admin");
  if (!session || !ROLES_COMPTABILITE.includes(session.role)) {
    redirect("/admin");
  }

  return (
    <div className={a.pageGlow}>
      <div className={a.pageGlowInner}>
        <div className={a.pageRoot}>
          {/* En-tête ET grille sont rendus par ComptabiliteBoard : les actions
              de page (nouvelle transaction, corbeille…) pilotent les cartes, il
              faut qu'elles vivent dans le même composant client qu'elles.
              Modifier et supprimer ont leurs propres permissions, réservées à
              l'admin par défaut : on ne montre pas au responsable des boutons
              que l'API lui refuserait. */}
          <ComptabiliteBoard
            peutModifier={session.permissions.includes("comptabilite:edit")}
            peutSupprimer={session.permissions.includes("comptabilite:delete")}
          />
        </div>
      </div>
    </div>
  );
}
