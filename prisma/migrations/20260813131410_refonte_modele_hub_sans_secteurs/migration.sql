/*
  Warnings:

  - You are about to drop the column `hub_arrivee_id` on the `bons_envoi` table. All the data in the column will be lost.
  - You are about to drop the column `hub_reception_id` on the `commandes` table. All the data in the column will be lost.
  - You are about to drop the column `secteur_id` on the `commandes` table. All the data in the column will be lost.
  - You are about to drop the column `hub_regional_id` on the `historique_statuts_commande` table. All the data in the column will be lost.
  - You are about to drop the column `hub_regional_id` on the `utilisateurs` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `villes` table. All the data in the column will be lost.
  - You are about to drop the `_LivreurSecteurs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `hubs_regionaux` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `secteurs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `zones_logistiques` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `hub_destination_id` to the `bons_envoi` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "_LivreurSecteurs" DROP CONSTRAINT "_LivreurSecteurs_A_fkey";

-- DropForeignKey
ALTER TABLE "_LivreurSecteurs" DROP CONSTRAINT "_LivreurSecteurs_B_fkey";

-- DropForeignKey
ALTER TABLE "bons_distribution" DROP CONSTRAINT "bons_distribution_hub_id_fkey";

-- DropForeignKey
ALTER TABLE "bons_envoi" DROP CONSTRAINT "bons_envoi_hub_arrivee_id_fkey";

-- DropForeignKey
ALTER TABLE "commandes" DROP CONSTRAINT "commandes_hub_reception_id_fkey";

-- DropForeignKey
ALTER TABLE "commandes" DROP CONSTRAINT "commandes_secteur_id_fkey";

-- DropForeignKey
ALTER TABLE "historique_statuts_commande" DROP CONSTRAINT "historique_statuts_commande_hub_regional_id_fkey";

-- DropForeignKey
ALTER TABLE "hubs_regionaux" DROP CONSTRAINT "hubs_regionaux_zone_id_fkey";

-- DropForeignKey
ALTER TABLE "secteurs" DROP CONSTRAINT "secteurs_ville_id_fkey";

-- DropForeignKey
ALTER TABLE "utilisateurs" DROP CONSTRAINT "utilisateurs_hub_regional_id_fkey";

-- DropForeignKey
ALTER TABLE "villes" DROP CONSTRAINT "villes_hub_id_fkey";

-- DropIndex
DROP INDEX "bons_envoi_hub_arrivee_id_idx";

-- DropIndex
DROP INDEX "commandes_hub_reception_id_idx";

-- DropIndex
DROP INDEX "commandes_secteur_id_idx";

-- DropIndex
DROP INDEX "historique_statuts_commande_hub_regional_id_idx";

-- AlterTable
ALTER TABLE "bons_envoi" DROP COLUMN "hub_arrivee_id",
ADD COLUMN     "hub_destination_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "commandes" DROP COLUMN "hub_reception_id",
DROP COLUMN "secteur_id",
ADD COLUMN     "hub_actuel_id" TEXT,
ADD COLUMN     "ville_id" TEXT;

-- AlterTable
ALTER TABLE "historique_statuts_commande" DROP COLUMN "hub_regional_id",
ADD COLUMN     "hub_id" TEXT;

-- AlterTable
ALTER TABLE "utilisateurs" DROP COLUMN "hub_regional_id",
ADD COLUMN     "hub_id" TEXT;

-- AlterTable
ALTER TABLE "villes" DROP COLUMN "type";

-- DropTable
DROP TABLE "_LivreurSecteurs";

-- DropTable
DROP TABLE "hubs_regionaux";

-- DropTable
DROP TABLE "secteurs";

-- DropTable
DROP TABLE "zones_logistiques";

-- DropEnum
DROP TYPE "TypeVille";

-- CreateTable
CREATE TABLE "hubs" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "adresse" TEXT,
    "telephone" TEXT,
    "is_central" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubs_nom_key" ON "hubs"("nom");

-- CreateIndex
CREATE INDEX "bons_envoi_hub_destination_id_idx" ON "bons_envoi"("hub_destination_id");

-- CreateIndex
CREATE INDEX "commandes_hub_actuel_id_idx" ON "commandes"("hub_actuel_id");

-- CreateIndex
CREATE INDEX "commandes_ville_id_idx" ON "commandes"("ville_id");

-- CreateIndex
CREATE INDEX "historique_statuts_commande_hub_id_idx" ON "historique_statuts_commande"("hub_id");

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_ville_id_fkey" FOREIGN KEY ("ville_id") REFERENCES "villes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_hub_actuel_id_fkey" FOREIGN KEY ("hub_actuel_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_hub_destination_id_fkey" FOREIGN KEY ("hub_destination_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_statuts_commande" ADD CONSTRAINT "historique_statuts_commande_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "villes" ADD CONSTRAINT "villes_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
