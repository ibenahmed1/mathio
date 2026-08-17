-- AlterTable
ALTER TABLE "produit_variantes" DROP COLUMN "quantite",
ADD COLUMN     "quantite_en_cours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantite_recue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "produits" DROP COLUMN "quantite",
ADD COLUMN     "quantite_en_cours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantite_recue" INTEGER NOT NULL DEFAULT 0;

