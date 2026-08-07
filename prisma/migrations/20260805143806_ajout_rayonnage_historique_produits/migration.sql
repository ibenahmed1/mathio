-- AlterTable
ALTER TABLE "produit_variantes" ADD COLUMN     "rayonnage" TEXT;

-- AlterTable
ALTER TABLE "produits" ADD COLUMN     "rayonnage" TEXT;

-- CreateTable
CREATE TABLE "historique_produits" (
    "id" TEXT NOT NULL,
    "produit_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_produits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historique_produits_produit_id_idx" ON "historique_produits"("produit_id");

-- AddForeignKey
ALTER TABLE "historique_produits" ADD CONSTRAINT "historique_produits_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

