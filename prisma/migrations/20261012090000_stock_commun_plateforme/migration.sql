-- § Stock commun d'une plateforme partenaire (décision du 12/10/2026).
--
-- Un produit appartient SOIT à un marchand (stock personnel), SOIT à une
-- plateforme (stock commun que tous ses marchands vendent, sans réservation
-- par marchand). Envois de stock annoncés par la plateforme, journal des
-- mouvements de stock, provenance des lignes de colis, colis en attente de
-- stock. Ajout seul : les produits existants gardent leur marchand.

-- CreateEnum
CREATE TYPE "ProvenanceStock" AS ENUM ('stock_marchand', 'stock_plateforme');

-- CreateEnum
CREATE TYPE "StatutEnvoiStock" AS ENUM ('attendu', 'recu_partiel', 'recu');

-- CreateEnum
CREATE TYPE "TypeMouvementStock" AS ENUM ('annonce', 'reception', 'sortie_colis', 'retour_colis', 'retrait', 'correction');

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "en_attente_stock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lignes_colis" ADD COLUMN     "provenance" "ProvenanceStock";

-- AlterTable
ALTER TABLE "produits" ADD COLUMN     "environnement_plateforme" "EnvironnementApi",
ADD COLUMN     "plateforme_id" TEXT,
ALTER COLUMN "marchand_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "envois_stock" (
    "id" TEXT NOT NULL,
    "plateforme_id" TEXT NOT NULL,
    "environnement" "EnvironnementApi" NOT NULL,
    "reference" TEXT NOT NULL,
    "statut" "StatutEnvoiStock" NOT NULL DEFAULT 'attendu',
    "date_annonce" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_reception" TIMESTAMP(3),

    CONSTRAINT "envois_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envois_stock_lignes" (
    "id" TEXT NOT NULL,
    "envoi_id" TEXT NOT NULL,
    "produit_id" TEXT NOT NULL,
    "variante_id" TEXT,
    "sku" TEXT NOT NULL,
    "quantite_annoncee" INTEGER NOT NULL,
    "quantite_recue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "envois_stock_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mouvements_stock" (
    "id" TEXT NOT NULL,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "TypeMouvementStock" NOT NULL,
    "produit_id" TEXT NOT NULL,
    "variante_id" TEXT,
    "quantite" INTEGER NOT NULL,
    "commande_id" TEXT,
    "marchand_id" TEXT,
    "envoi_id" TEXT,
    "utilisateur_id" TEXT,
    "motif" TEXT,

    CONSTRAINT "mouvements_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "envois_stock_statut_idx" ON "envois_stock"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "envois_stock_plateforme_id_environnement_reference_key" ON "envois_stock"("plateforme_id", "environnement", "reference");

-- CreateIndex
CREATE INDEX "envois_stock_lignes_envoi_id_idx" ON "envois_stock_lignes"("envoi_id");

-- CreateIndex
CREATE INDEX "envois_stock_lignes_produit_id_idx" ON "envois_stock_lignes"("produit_id");

-- CreateIndex
CREATE INDEX "mouvements_stock_produit_id_horodatage_idx" ON "mouvements_stock"("produit_id", "horodatage");

-- CreateIndex
CREATE INDEX "mouvements_stock_commande_id_idx" ON "mouvements_stock"("commande_id");

-- CreateIndex
CREATE INDEX "mouvements_stock_marchand_id_idx" ON "mouvements_stock"("marchand_id");

-- CreateIndex
CREATE INDEX "produits_plateforme_id_idx" ON "produits"("plateforme_id");

-- CreateIndex
CREATE UNIQUE INDEX "produits_plateforme_id_environnement_plateforme_reference_key" ON "produits"("plateforme_id", "environnement_plateforme", "reference");

-- AddForeignKey
ALTER TABLE "produits" ADD CONSTRAINT "produits_plateforme_id_fkey" FOREIGN KEY ("plateforme_id") REFERENCES "plateformes_partenaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois_stock" ADD CONSTRAINT "envois_stock_plateforme_id_fkey" FOREIGN KEY ("plateforme_id") REFERENCES "plateformes_partenaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois_stock_lignes" ADD CONSTRAINT "envois_stock_lignes_envoi_id_fkey" FOREIGN KEY ("envoi_id") REFERENCES "envois_stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois_stock_lignes" ADD CONSTRAINT "envois_stock_lignes_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envois_stock_lignes" ADD CONSTRAINT "envois_stock_lignes_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "produit_variantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "produit_variantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_envoi_id_fkey" FOREIGN KEY ("envoi_id") REFERENCES "envois_stock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactement un propriétaire par produit ; un produit commun porte
-- l'environnement de la clé qui l'a déclaré (le bac à sable ne partage jamais
-- son stock avec la production).
ALTER TABLE "produits" ADD CONSTRAINT "produits_un_seul_proprietaire" CHECK (
  ("marchand_id" IS NOT NULL AND "plateforme_id" IS NULL AND "environnement_plateforme" IS NULL)
  OR ("marchand_id" IS NULL AND "plateforme_id" IS NOT NULL AND "environnement_plateforme" IS NOT NULL)
);

-- Les lignes de colis déjà rattachées à un produit du stock en sortent toutes
-- du stock personnel de leur marchand : il n'existait pas d'autre stock.
UPDATE "lignes_colis" SET "provenance" = 'stock_marchand' WHERE "produit_id" IS NOT NULL;
