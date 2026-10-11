-- § Gestion de stock : un colis "stock" désigne désormais la variante qu'il
-- consomme, et garde la trace de la réservation et de la réintégration de
-- son stock (lib/stock-colis.ts). Colonnes facultatives : ajout seul.

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN "variante_id" TEXT;
ALTER TABLE "commandes" ADD COLUMN "stock_reserve_le" TIMESTAMP(3);
ALTER TABLE "commandes" ADD COLUMN "stock_reintegre_le" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "commandes_variante_id_idx" ON "commandes"("variante_id");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "produit_variantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Colis déjà passés en préparation avant cette migration : leur stock a été
-- décrémenté par l'ancienne route. On date la réservation à leur passage en
-- pret_pour_preparation pour qu'une réintégration reste possible, et jamais
-- double.
UPDATE "commandes" c
SET "stock_reserve_le" = h.premier
FROM (
  SELECT "commande_id", MIN("horodatage") AS premier
  FROM "historique_statuts_commande"
  WHERE "nouveau_statut" = 'pret_pour_preparation'
  GROUP BY "commande_id"
) h
WHERE h."commande_id" = c."id" AND c."enStock" = true AND c."produit_id" IS NOT NULL;

-- Produits à variantes : le compteur "en cours" du produit recevait la somme
-- des variantes à la création, puis n'était plus jamais tenu à jour. Toutes
-- les lectures passent par les variantes (lib/stock-quantites.ts) : on le
-- remet à 0, comme le schéma le documente.
UPDATE "produits" SET "quantite_en_cours" = 0, "quantite_recue" = 0 WHERE "variantes_activees" = true;
