-- AlterTable
ALTER TABLE "commandes" DROP COLUMN "zone",
ADD COLUMN     "aRemplacer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enStock" BOOLEAN NOT NULL DEFAULT false;

