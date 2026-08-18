-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "code_suivi_partenaire" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "commandes_marchand_ref_partenaire_key" ON "commandes"("marchand_id", "code_suivi_partenaire");

