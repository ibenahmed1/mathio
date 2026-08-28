import { redirect } from "next/navigation";
import ComptabiliteBoard from "@/components/accounting/ComptabiliteBoard";
import { SidebarToggleButtons } from "@/components/admin/SidebarToggleButtons";
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
          {/* ---------- En-tête ---------- */}
          <header className={a.pageHead}>
            <div className={a.titleRow}>
              <SidebarToggleButtons className={a.sidebarToggle} />
              <h1 className="page-title">Comptabilité &amp; paie</h1>
            </div>
          </header>

          {/* ---------- Grille comptabilité ---------- */}
          <ComptabiliteBoard />
        </div>
      </div>
    </div>
  );
}
