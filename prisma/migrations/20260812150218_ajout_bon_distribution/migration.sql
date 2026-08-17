/*
  Warnings:

  - You are about to drop the column `zone_distribution_id` on the `bons_distribution` table. All the data in the column will be lost.
  - You are about to drop the column `zone_distribution_id` on the `secteurs` table. All the data in the column will be lost.
  - You are about to drop the `zones_distribution` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[ville_id,nom]` on the table `secteurs` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hub_id` to the `bons_distribution` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ville_id` to the `secteurs` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "bons_distribution" DROP CONSTRAINT "bons_distribution_zone_distribution_id_fkey";

-- DropForeignKey
ALTER TABLE "secteurs" DROP CONSTRAINT "secteurs_zone_distribution_id_fkey";

-- DropForeignKey
ALTER TABLE "zones_distribution" DROP CONSTRAINT "zones_distribution_hub_id_fkey";

-- DropIndex
DROP INDEX "bons_distribution_zone_distribution_id_idx";

-- DropIndex
DROP INDEX "secteurs_zone_distribution_id_idx";

-- DropIndex
DROP INDEX "secteurs_zone_distribution_id_nom_key";

-- AlterTable
ALTER TABLE "bons_distribution" DROP COLUMN "zone_distribution_id",
ADD COLUMN     "hub_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "secteurs" DROP COLUMN "zone_distribution_id",
ADD COLUMN     "ville_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "zones_distribution";

-- CreateIndex
CREATE INDEX "bons_distribution_hub_id_idx" ON "bons_distribution"("hub_id");

-- CreateIndex
CREATE INDEX "secteurs_ville_id_idx" ON "secteurs"("ville_id");

-- CreateIndex
CREATE UNIQUE INDEX "secteurs_ville_id_nom_key" ON "secteurs"("ville_id", "nom");

-- AddForeignKey
ALTER TABLE "secteurs" ADD CONSTRAINT "secteurs_ville_id_fkey" FOREIGN KEY ("ville_id") REFERENCES "villes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs_regionaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
