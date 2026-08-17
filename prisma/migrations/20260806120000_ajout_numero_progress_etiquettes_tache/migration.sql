-- AlterTable
ALTER TABLE "taches"
ADD COLUMN "etiquettes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "numero" SERIAL NOT NULL,
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "taches_numero_key" ON "taches"("numero");
