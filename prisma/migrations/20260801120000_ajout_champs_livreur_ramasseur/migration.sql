-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "cin" TEXT,
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "zone_principale" TEXT,
ADD COLUMN     "zone_secondaire" TEXT,
ADD COLUMN     "adresse" TEXT,
ADD COLUMN     "nom_banque" TEXT,
ADD COLUMN     "numero_compte" TEXT,
ADD COLUMN     "frais_livraison" DECIMAL(10,2),
ADD COLUMN     "frais_refus" DECIMAL(10,2),
ADD COLUMN     "cin_recto_url" TEXT,
ADD COLUMN     "cin_verso_url" TEXT,
ADD COLUMN     "rib_photo_url" TEXT;
