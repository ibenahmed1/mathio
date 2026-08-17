-- CreateEnum
CREATE TYPE "TypeTransaction" AS ENUM ('revenu', 'depense');

-- CreateEnum
CREATE TYPE "CategorieTransaction" AS ENUM ('paiement_client', 'frais_livraison', 'abonnement_outil', 'salaire', 'remboursement', 'autre');

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "type" "TypeTransaction" NOT NULL,
    "categorie" "CategorieTransaction" NOT NULL,
    "date_effet" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "auteur_id" TEXT NOT NULL,
    "est_annulee" BOOLEAN NOT NULL DEFAULT false,
    "transaction_origine_id" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transaction_origine_id_key" ON "transactions"("transaction_origine_id");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_categorie_idx" ON "transactions"("categorie");

-- CreateIndex
CREATE INDEX "transactions_date_effet_idx" ON "transactions"("date_effet");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transaction_origine_id_fkey" FOREIGN KEY ("transaction_origine_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

