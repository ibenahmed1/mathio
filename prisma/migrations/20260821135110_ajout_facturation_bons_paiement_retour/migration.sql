-- CreateEnum
CREATE TYPE "StatutFacture" AS ENUM ('emise', 'payee', 'annulee');

-- CreateEnum
CREATE TYPE "StatutBonPaiement" AS ENUM ('emis', 'regle');

-- CreateEnum
CREATE TYPE "StatutBonRetour" AS ENUM ('nouveau', 'en_cours', 'remis');

-- AlterTable
ALTER TABLE "bons_distribution" ADD COLUMN     "bon_paiement_id" TEXT;

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "bon_retour_id" TEXT;

-- AlterTable
ALTER TABLE "marchands" ADD COLUMN     "frais_livraison" DECIMAL(10,2),
ADD COLUMN     "frais_retour" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "tarifs_marchand_ville" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "ville_id" TEXT NOT NULL,
    "frais_livraison" DECIMAL(10,2) NOT NULL,
    "frais_retour" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "tarifs_marchand_ville_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factures" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "statut" "StatutFacture" NOT NULL DEFAULT 'emise',
    "nb_colis_livres" INTEGER NOT NULL,
    "nb_colis_retournes" INTEGER NOT NULL,
    "total_cod" DECIMAL(12,2) NOT NULL,
    "total_frais_livraison" DECIMAL(12,2) NOT NULL,
    "total_frais_retour" DECIMAL(12,2) NOT NULL,
    "net_a_payer" DECIMAL(12,2) NOT NULL,
    "date_emission" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_paiement" TIMESTAMP(3),
    "date_annulation" TIMESTAMP(3),
    "emise_par_id" TEXT NOT NULL,
    "transaction_id" TEXT,

    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_facture" (
    "id" TEXT NOT NULL,
    "facture_id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "livre" BOOLEAN NOT NULL,
    "montant_cod" DECIMAL(10,2) NOT NULL,
    "frais" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "lignes_facture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bons_paiement" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "livreur_id" TEXT NOT NULL,
    "hub_id" TEXT,
    "statut" "StatutBonPaiement" NOT NULL DEFAULT 'emis',
    "nb_tournees" INTEGER NOT NULL,
    "nb_colis_livres" INTEGER NOT NULL,
    "nb_colis_retournes" INTEGER NOT NULL,
    "montant_total" DECIMAL(12,2) NOT NULL,
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_reglement" TIMESTAMP(3),
    "emis_par_id" TEXT NOT NULL,
    "transaction_id" TEXT,

    CONSTRAINT "bons_paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bons_retour" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "hub_id" TEXT,
    "statut" "StatutBonRetour" NOT NULL DEFAULT 'nouveau',
    "nb_colis" INTEGER NOT NULL,
    "montant_total_cod" DECIMAL(12,2) NOT NULL,
    "date_generation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cree_par_id" TEXT NOT NULL,
    "ramasseur_id" TEXT,
    "date_affectation" TIMESTAMP(3),
    "date_remise" TIMESTAMP(3),
    "nom_signataire" TEXT,
    "signature_url" TEXT,
    "photo_decharge_url" TEXT,

    CONSTRAINT "bons_retour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tarifs_marchand_ville_ville_id_idx" ON "tarifs_marchand_ville"("ville_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarifs_marchand_ville_marchand_id_ville_id_key" ON "tarifs_marchand_ville"("marchand_id", "ville_id");

-- CreateIndex
CREATE UNIQUE INDEX "factures_numero_key" ON "factures"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "factures_transaction_id_key" ON "factures"("transaction_id");

-- CreateIndex
CREATE INDEX "factures_marchand_id_idx" ON "factures"("marchand_id");

-- CreateIndex
CREATE INDEX "factures_statut_idx" ON "factures"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "lignes_facture_commande_id_key" ON "lignes_facture"("commande_id");

-- CreateIndex
CREATE INDEX "lignes_facture_facture_id_idx" ON "lignes_facture"("facture_id");

-- CreateIndex
CREATE UNIQUE INDEX "bons_paiement_numero_key" ON "bons_paiement"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "bons_paiement_transaction_id_key" ON "bons_paiement"("transaction_id");

-- CreateIndex
CREATE INDEX "bons_paiement_livreur_id_idx" ON "bons_paiement"("livreur_id");

-- CreateIndex
CREATE INDEX "bons_paiement_hub_id_idx" ON "bons_paiement"("hub_id");

-- CreateIndex
CREATE INDEX "bons_paiement_statut_idx" ON "bons_paiement"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "bons_retour_numero_key" ON "bons_retour"("numero");

-- CreateIndex
CREATE INDEX "bons_retour_marchand_id_idx" ON "bons_retour"("marchand_id");

-- CreateIndex
CREATE INDEX "bons_retour_ramasseur_id_idx" ON "bons_retour"("ramasseur_id");

-- CreateIndex
CREATE INDEX "bons_retour_hub_id_idx" ON "bons_retour"("hub_id");

-- CreateIndex
CREATE INDEX "bons_retour_statut_idx" ON "bons_retour"("statut");

-- CreateIndex
CREATE INDEX "bons_distribution_bon_paiement_id_idx" ON "bons_distribution"("bon_paiement_id");

-- CreateIndex
CREATE INDEX "commandes_bon_retour_id_idx" ON "commandes"("bon_retour_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_bon_retour_id_fkey" FOREIGN KEY ("bon_retour_id") REFERENCES "bons_retour"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_distribution" ADD CONSTRAINT "bons_distribution_bon_paiement_id_fkey" FOREIGN KEY ("bon_paiement_id") REFERENCES "bons_paiement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_marchand_ville" ADD CONSTRAINT "tarifs_marchand_ville_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_marchand_ville" ADD CONSTRAINT "tarifs_marchand_ville_ville_id_fkey" FOREIGN KEY ("ville_id") REFERENCES "villes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_emise_par_id_fkey" FOREIGN KEY ("emise_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_facture" ADD CONSTRAINT "lignes_facture_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_facture" ADD CONSTRAINT "lignes_facture_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_paiement" ADD CONSTRAINT "bons_paiement_livreur_id_fkey" FOREIGN KEY ("livreur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_paiement" ADD CONSTRAINT "bons_paiement_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_paiement" ADD CONSTRAINT "bons_paiement_emis_par_id_fkey" FOREIGN KEY ("emis_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_paiement" ADD CONSTRAINT "bons_paiement_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_retour" ADD CONSTRAINT "bons_retour_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_retour" ADD CONSTRAINT "bons_retour_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_retour" ADD CONSTRAINT "bons_retour_cree_par_id_fkey" FOREIGN KEY ("cree_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bons_retour" ADD CONSTRAINT "bons_retour_ramasseur_id_fkey" FOREIGN KEY ("ramasseur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
