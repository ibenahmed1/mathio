-- CreateEnum
CREATE TYPE "TypeVille" AS ENUM ('principale', 'satellite');

-- CreateTable
CREATE TABLE "zones_logistiques" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,

    CONSTRAINT "zones_logistiques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubs_regionaux" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "hubs_regionaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "villes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "TypeVille" NOT NULL,
    "hub_id" TEXT NOT NULL,

    CONSTRAINT "villes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_logistiques_code_key" ON "zones_logistiques"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hubs_regionaux_nom_key" ON "hubs_regionaux"("nom");

-- CreateIndex
CREATE INDEX "hubs_regionaux_zone_id_idx" ON "hubs_regionaux"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "villes_nom_key" ON "villes"("nom");

-- CreateIndex
CREATE INDEX "villes_hub_id_idx" ON "villes"("hub_id");

-- AddForeignKey
ALTER TABLE "hubs_regionaux" ADD CONSTRAINT "hubs_regionaux_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones_logistiques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "villes" ADD CONSTRAINT "villes_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs_regionaux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

