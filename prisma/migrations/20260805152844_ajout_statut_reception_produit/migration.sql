-- CreateEnum
CREATE TYPE "StatutReceptionProduit" AS ENUM ('pas_encore_recu', 'recu');

-- AlterTable
ALTER TABLE "produits" ADD COLUMN     "statut_reception" "StatutReceptionProduit" NOT NULL DEFAULT 'pas_encore_recu';

