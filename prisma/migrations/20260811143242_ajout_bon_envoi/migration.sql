-- CreateEnum
CREATE TYPE "StatutBonEnvoi" AS ENUM ('nouveau', 'recu');

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "bon_envoi_id" TEXT;

-- CreateTable
CREATE TABLE "bons_envoi" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "hub_arrivee_id" TEXT NOT NULL,
    "statut" "StatutBonEnvoi" NOT NULL DEFAULT 'nouveau',
    "nb_colis" INTEGER NOT NULL,
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_reception" TIMESTAMP(3),
    "receptionnaire_id" TEXT,

    CONSTRAINT "bons_envoi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bons_envoi_numero_key" ON "bons_envoi"("numero");

-- CreateIndex
CREATE INDEX "bons_envoi_hub_arrivee_id_idx" ON "bons_envoi"("hub_arrivee_id");

-- CreateIndex
CREATE INDEX "commandes_bon_envoi_id_idx" ON "commandes"("bon_envoi_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_bon_envoi_id_fkey" FOREIGN KEY ("bon_envoi_id") REFERENCES "bons_envoi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_hub_arrivee_id_fkey" FOREIGN KEY ("hub_arrivee_id") REFERENCES "hubs_regionaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_receptionnaire_id_fkey" FOREIGN KEY ("receptionnaire_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
