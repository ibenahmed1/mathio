-- AlterTable
ALTER TABLE "hubs" ADD COLUMN     "prestataire_id" TEXT;

-- CreateTable
CREATE TABLE "prestataires" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "contact" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "prestataires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifs_prestataire_ville" (
    "id" TEXT NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "ville_id" TEXT NOT NULL,
    "tarif_livraison" DECIMAL(10,2) NOT NULL,
    "tarif_retour" DECIMAL(10,2),

    CONSTRAINT "tarifs_prestataire_ville_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prestataires_nom_key" ON "prestataires"("nom");

-- CreateIndex
CREATE INDEX "tarifs_prestataire_ville_ville_id_idx" ON "tarifs_prestataire_ville"("ville_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarifs_prestataire_ville_prestataire_id_ville_id_key" ON "tarifs_prestataire_ville"("prestataire_id", "ville_id");

-- CreateIndex
CREATE INDEX "hubs_prestataire_id_idx" ON "hubs"("prestataire_id");

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_prestataire_ville" ADD CONSTRAINT "tarifs_prestataire_ville_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifs_prestataire_ville" ADD CONSTRAINT "tarifs_prestataire_ville_ville_id_fkey" FOREIGN KEY ("ville_id") REFERENCES "villes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
