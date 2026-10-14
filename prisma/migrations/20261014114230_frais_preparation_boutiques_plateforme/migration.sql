-- § Frais de préparation (14/10/2026) : facturés sur chaque colis, livré comme
-- retourné. Les boutiques de plateforme de vente (Shipeh) paient 30 DH de
-- livraison partout au Maroc et 3 DH de préparation par colis.

-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "total_frais_preparation" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "lignes_facture" ADD COLUMN     "frais_preparation" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "marchands" ADD COLUMN     "frais_preparation" DECIMAL(10,2);

-- Boutiques déjà rattachées à une plateforme de vente (compte machine sans
-- transporteur, même règle que restreindrePourPlateforme).
UPDATE "marchands" m
SET "frais_livraison" = 30, "frais_preparation" = 3
WHERE EXISTS (
  SELECT 1
  FROM "comptes_marchands_externes" c
  JOIN "plateformes_partenaires" p ON p."id" = c."plateforme_id"
  WHERE c."marchand_id" = m."id" AND p."prestataire_id" IS NULL
);
