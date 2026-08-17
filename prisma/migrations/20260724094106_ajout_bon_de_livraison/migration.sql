-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "bon_livraison_id" TEXT;

-- CreateTable
CREATE TABLE "bons_de_livraison" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "nb_colis" INTEGER NOT NULL,
    "montant_total_cod" DECIMAL(10,2) NOT NULL,
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bons_de_livraison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bons_de_livraison_numero_key" ON "bons_de_livraison"("numero");

-- CreateIndex
CREATE INDEX "bons_de_livraison_marchand_id_idx" ON "bons_de_livraison"("marchand_id");

-- CreateIndex
CREATE INDEX "commandes_bon_livraison_id_idx" ON "commandes"("bon_livraison_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_bon_livraison_id_fkey" FOREIGN KEY ("bon_livraison_id") REFERENCES "bons_de_livraison"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_de_livraison" ADD CONSTRAINT "bons_de_livraison_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
