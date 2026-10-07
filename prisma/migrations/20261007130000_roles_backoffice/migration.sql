-- § Équipe & rôles (/admin/equipe, onglet Rôles & permissions) : rôles de
-- l'équipe interne, prédéfinis (modifiables) ou personnalisés, et le rôle
-- attribué à chaque compte. Ajout seul : table neuve, colonne facultative.
-- Les rôles prédéfinis ne sont PAS insérés ici : ils se créent à la première
-- visite à partir de ROLE_PERMISSIONS (lib/roles-backoffice-serveur.ts).

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "role_backoffice_id" TEXT;

-- CreateTable
CREATE TABLE "roles_backoffice" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "fonction" "Role" NOT NULL,
    "cle" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_modification" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_backoffice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_backoffice_nom_key" ON "roles_backoffice"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "roles_backoffice_cle_key" ON "roles_backoffice"("cle");

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_role_backoffice_id_fkey" FOREIGN KEY ("role_backoffice_id") REFERENCES "roles_backoffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
