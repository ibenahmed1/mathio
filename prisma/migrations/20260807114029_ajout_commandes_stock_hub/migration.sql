-- CreateEnum
CREATE TYPE "StatutCommandeStockHub" AS ENUM ('en_attente', 'livre', 'annulee');

-- CreateTable
CREATE TABLE "commandes_stock_hub" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "titre" TEXT NOT NULL,
    "sous_titre" TEXT,
    "montant" DECIMAL(10,2) NOT NULL,
    "statut" "StatutCommandeStockHub" NOT NULL DEFAULT 'en_attente',
    "mode_paiement" TEXT NOT NULL,
    "date_commande" TIMESTAMP(3) NOT NULL,
    "auteur_id" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commandes_stock_hub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commandes_stock_hub_numero_key" ON "commandes_stock_hub"("numero");

-- CreateIndex
CREATE INDEX "commandes_stock_hub_statut_idx" ON "commandes_stock_hub"("statut");

-- AddForeignKey
ALTER TABLE "commandes_stock_hub" ADD CONSTRAINT "commandes_stock_hub_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

