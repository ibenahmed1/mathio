-- CreateTable
CREATE TABLE "produits" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "nom_produit" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "photo_url" TEXT,
    "variantes_activees" BOOLEAN NOT NULL DEFAULT false,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produit_variantes" (
    "id" TEXT NOT NULL,
    "produit_id" TEXT NOT NULL,
    "nom_variante" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "produit_variantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "produits_marchand_id_idx" ON "produits"("marchand_id");

-- CreateIndex
CREATE UNIQUE INDEX "produits_marchand_id_reference_key" ON "produits"("marchand_id", "reference");

-- CreateIndex
CREATE INDEX "produit_variantes_produit_id_idx" ON "produit_variantes"("produit_id");

-- CreateIndex
CREATE UNIQUE INDEX "produit_variantes_produit_id_reference_key" ON "produit_variantes"("produit_id", "reference");

-- AddForeignKey
ALTER TABLE "produits" ADD CONSTRAINT "produits_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produit_variantes" ADD CONSTRAINT "produit_variantes_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

