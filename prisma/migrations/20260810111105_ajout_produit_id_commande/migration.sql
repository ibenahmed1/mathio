-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "produit_id" TEXT;

-- CreateIndex
CREATE INDEX "commandes_produit_id_idx" ON "commandes"("produit_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
