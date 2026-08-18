-- CreateEnum
CREATE TYPE "StatutBonPreparation" AS ENUM ('en_attente', 'validee');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatutCommande" ADD VALUE 'pret_pour_preparation';
ALTER TYPE "StatutCommande" ADD VALUE 'recu_au_hub';
ALTER TYPE "StatutCommande" ADD VALUE 'en_transit';

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "bon_preparation_id" TEXT;

-- CreateTable
CREATE TABLE "bons_de_preparation" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "nb_colis" INTEGER NOT NULL,
    "statut" "StatutBonPreparation" NOT NULL DEFAULT 'en_attente',
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_validation" TIMESTAMP(3),
    "validateur_id" TEXT,

    CONSTRAINT "bons_de_preparation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bons_de_preparation_numero_key" ON "bons_de_preparation"("numero");

-- CreateIndex
CREATE INDEX "bons_de_preparation_marchand_id_idx" ON "bons_de_preparation"("marchand_id");

-- CreateIndex
CREATE INDEX "commandes_bon_preparation_id_idx" ON "commandes"("bon_preparation_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_bon_preparation_id_fkey" FOREIGN KEY ("bon_preparation_id") REFERENCES "bons_de_preparation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_de_preparation" ADD CONSTRAINT "bons_de_preparation_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_de_preparation" ADD CONSTRAINT "bons_de_preparation_validateur_id_fkey" FOREIGN KEY ("validateur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
