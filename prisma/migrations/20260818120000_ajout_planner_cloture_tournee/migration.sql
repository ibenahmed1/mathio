-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'planner';

-- AlterEnum
ALTER TYPE "StatutBonDistribution" ADD VALUE 'cloture';

-- AlterEnum
ALTER TYPE "StatutCommande" ADD VALUE 'retourne_au_hub';

-- AlterTable
ALTER TABLE "bons_distribution" ADD COLUMN     "cloture_par_id" TEXT,
ADD COLUMN     "date_cloture" TIMESTAMP(3),
ADD COLUMN     "ecart_caisse" DECIMAL(10,2),
ADD COLUMN     "gain_livreur" DECIMAL(10,2),
ADD COLUMN     "gain_regle_le" TIMESTAMP(3),
ADD COLUMN     "montant_crbt_attendu" DECIMAL(10,2),
ADD COLUMN     "montant_remis" DECIMAL(10,2),
ADD COLUMN     "nb_colis_livres" INTEGER,
ADD COLUMN     "nb_colis_retournes" INTEGER,
ADD COLUMN     "planner_id" TEXT,
ADD COLUMN     "transaction_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bons_distribution_transaction_id_key" ON "bons_distribution"("transaction_id");

-- CreateIndex
CREATE INDEX "bons_distribution_statut_idx" ON "bons_distribution"("statut");

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_planner_id_fkey" FOREIGN KEY ("planner_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_cloture_par_id_fkey" FOREIGN KEY ("cloture_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
