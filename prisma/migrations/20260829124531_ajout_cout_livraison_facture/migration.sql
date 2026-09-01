-- CreateEnum
CREATE TYPE "SourceCoutLivraison" AS ENUM ('livreur', 'prestataire');

-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "nb_lignes_cout_inconnu" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_cout_livraison" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "lignes_facture" ADD COLUMN     "cout_livraison" DECIMAL(10,2),
ADD COLUMN     "cout_source" "SourceCoutLivraison";
