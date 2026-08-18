-- CreateEnum
CREATE TYPE "StatutBonDistribution" AS ENUM ('nouveau', 'en_cours');

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "bon_distribution_id" TEXT,
ADD COLUMN     "secteur_id" TEXT;

-- CreateTable
CREATE TABLE "zones_distribution" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,

    CONSTRAINT "zones_distribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secteurs" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "zone_distribution_id" TEXT NOT NULL,

    CONSTRAINT "secteurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bons_distribution" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "livreur_id" TEXT NOT NULL,
    "zone_distribution_id" TEXT NOT NULL,
    "statut" "StatutBonDistribution" NOT NULL DEFAULT 'en_cours',
    "nb_colis" INTEGER NOT NULL,
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bons_distribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LivreurSecteurs" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LivreurSecteurs_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "zones_distribution_hub_id_idx" ON "zones_distribution"("hub_id");

-- CreateIndex
CREATE INDEX "secteurs_zone_distribution_id_idx" ON "secteurs"("zone_distribution_id");

-- CreateIndex
CREATE UNIQUE INDEX "secteurs_zone_distribution_id_nom_key" ON "secteurs"("zone_distribution_id", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "bons_distribution_numero_key" ON "bons_distribution"("numero");

-- CreateIndex
CREATE INDEX "bons_distribution_livreur_id_idx" ON "bons_distribution"("livreur_id");

-- CreateIndex
CREATE INDEX "bons_distribution_zone_distribution_id_idx" ON "bons_distribution"("zone_distribution_id");

-- CreateIndex
CREATE INDEX "_LivreurSecteurs_B_index" ON "_LivreurSecteurs"("B");

-- CreateIndex
CREATE INDEX "commandes_bon_distribution_id_idx" ON "commandes"("bon_distribution_id");

-- CreateIndex
CREATE INDEX "commandes_secteur_id_idx" ON "commandes"("secteur_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_bon_distribution_id_fkey" FOREIGN KEY ("bon_distribution_id") REFERENCES "bons_distribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_secteur_id_fkey" FOREIGN KEY ("secteur_id") REFERENCES "secteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones_distribution" ADD CONSTRAINT "zones_distribution_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs_regionaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secteurs" ADD CONSTRAINT "secteurs_zone_distribution_id_fkey" FOREIGN KEY ("zone_distribution_id") REFERENCES "zones_distribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_livreur_id_fkey" FOREIGN KEY ("livreur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_zone_distribution_id_fkey" FOREIGN KEY ("zone_distribution_id") REFERENCES "zones_distribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LivreurSecteurs" ADD CONSTRAINT "_LivreurSecteurs_A_fkey" FOREIGN KEY ("A") REFERENCES "secteurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LivreurSecteurs" ADD CONSTRAINT "_LivreurSecteurs_B_fkey" FOREIGN KEY ("B") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
