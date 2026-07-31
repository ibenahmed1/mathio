-- CreateEnum
CREATE TYPE "EtatPaiement" AS ENUM ('non_paye', 'facture', 'paye');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatutCommande" ADD VALUE 'recu_agence_depart';
ALTER TYPE "StatutCommande" ADD VALUE 'recu_agence_destination';
ALTER TYPE "StatutCommande" ADD VALUE 'mise_en_distribution';
ALTER TYPE "StatutCommande" ADD VALUE 'recu_client';
ALTER TYPE "StatutCommande" ADD VALUE 'injoignable';
ALTER TYPE "StatutCommande" ADD VALUE 'refusee';
ALTER TYPE "StatutCommande" ADD VALUE 'expedie_retour';
ALTER TYPE "StatutCommande" ADD VALUE 'retour_centre';

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "etat_paiement" "EtatPaiement" NOT NULL DEFAULT 'non_paye';
