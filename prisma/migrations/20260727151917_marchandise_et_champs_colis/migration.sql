-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "colis_a_remplacer_id" TEXT,
ADD COLUMN     "fragile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marchandise_id" TEXT,
ADD COLUMN     "ouvrir" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zone" TEXT;

-- DropTable
DROP TABLE "produits";

-- CreateTable
CREATE TABLE "marchandises" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "nom_marchandise" TEXT NOT NULL,
    "qte_stock" INTEGER NOT NULL DEFAULT 0,
    "prix" DECIMAL(10,2) NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marchandises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marchandises_marchand_id_idx" ON "marchandises"("marchand_id");

-- CreateIndex
CREATE UNIQUE INDEX "marchandises_marchand_id_nom_marchandise_key" ON "marchandises"("marchand_id", "nom_marchandise");

-- CreateIndex
CREATE INDEX "commandes_marchandise_id_idx" ON "commandes"("marchandise_id");

-- CreateIndex
CREATE INDEX "commandes_colis_a_remplacer_id_idx" ON "commandes"("colis_a_remplacer_id");

-- AddForeignKey
ALTER TABLE "marchandises" ADD CONSTRAINT "marchandises_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_marchandise_id_fkey" FOREIGN KEY ("marchandise_id") REFERENCES "marchandises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_colis_a_remplacer_id_fkey" FOREIGN KEY ("colis_a_remplacer_id") REFERENCES "commandes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
