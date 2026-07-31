-- CreateEnum
CREATE TYPE "StatutReclamation" AS ENUM ('ouverte', 'en_cours', 'resolue', 'rejetee');

-- AlterTable
ALTER TABLE "utilisateurs" ALTER COLUMN "telephone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "marchand_membres" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marchand_membres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reclamations" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "commande_id" TEXT,
    "utilisateur_id" TEXT NOT NULL,
    "sujet" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "statut" "StatutReclamation" NOT NULL DEFAULT 'ouverte',
    "reponse" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_reponse" TIMESTAMP(3),

    CONSTRAINT "reclamations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marchand_membres_utilisateur_id_key" ON "marchand_membres"("utilisateur_id");

-- CreateIndex
CREATE INDEX "marchand_membres_marchand_id_idx" ON "marchand_membres"("marchand_id");

-- CreateIndex
CREATE INDEX "reclamations_marchand_id_idx" ON "reclamations"("marchand_id");

-- CreateIndex
CREATE INDEX "reclamations_commande_id_idx" ON "reclamations"("commande_id");

-- AddForeignKey
ALTER TABLE "marchand_membres" ADD CONSTRAINT "marchand_membres_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marchand_membres" ADD CONSTRAINT "marchand_membres_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamations" ADD CONSTRAINT "reclamations_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamations" ADD CONSTRAINT "reclamations_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamations" ADD CONSTRAINT "reclamations_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
