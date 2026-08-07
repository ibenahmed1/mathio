-- Refonte des rôles équipe : finance/sav/agent_confirmation -> responsable/moderateur/equipe_suivi
-- (mapping conservant un périmètre de permissions équivalent, voir schema.prisma).
-- superviseur est un rôle neuf (portée large), sans données existantes à migrer.
BEGIN;

CREATE TYPE "Role_new" AS ENUM ('admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'marchand', 'livreur', 'ramasseur');

ALTER TABLE "utilisateurs" ADD COLUMN "role_new" "Role_new";

UPDATE "utilisateurs" SET "role_new" = CASE "role"::text
    WHEN 'agent_confirmation' THEN 'equipe_suivi'
    WHEN 'sav' THEN 'moderateur'
    WHEN 'finance' THEN 'responsable'
    ELSE "role"::text
END::"Role_new";

ALTER TABLE "utilisateurs" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "utilisateurs" DROP COLUMN "role";
ALTER TABLE "utilisateurs" RENAME COLUMN "role_new" TO "role";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

COMMIT;

-- CreateTable
CREATE TABLE "tarifs_livreur_ville" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "ville_id" TEXT NOT NULL,
    "frais_livraison" DECIMAL(10,2) NOT NULL,
    "frais_refus" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "tarifs_livreur_ville_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tarifs_livreur_ville_ville_id_idx" ON "tarifs_livreur_ville"("ville_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarifs_livreur_ville_utilisateur_id_ville_id_key" ON "tarifs_livreur_ville"("utilisateur_id", "ville_id");

-- AddForeignKey
ALTER TABLE "tarifs_livreur_ville" ADD CONSTRAINT "tarifs_livreur_ville_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_livreur_ville" ADD CONSTRAINT "tarifs_livreur_ville_ville_id_fkey" FOREIGN KEY ("ville_id") REFERENCES "villes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
