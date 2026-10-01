-- § Intégration Shopify : quatre tables satellites, AUCUNE colonne ajoutée sur
-- commandes, marchandises ni marchands (cf. prisma/schema.prisma).

-- CreateTable
CREATE TABLE "boutiques_shopify" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "domaine" TEXT NOT NULL,
    "nom" TEXT,
    "devise" TEXT,
    "jeton_acces_chiffre" TEXT NOT NULL,
    "cle_secrete_chiffree" TEXT NOT NULL,
    "webhook_id" TEXT,
    "webhook_uri" TEXT,
    "connectee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deconnectee_le" TIMESTAMP(3),
    "derniere_synchro_produits_le" TIMESTAMP(3),
    "derniere_erreur" TEXT,
    "date_maj" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boutiques_shopify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commandes_shopify" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "boutique_id" TEXT NOT NULL,
    "id_commande_shopify" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "devise" TEXT,
    "date_reception" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commandes_shopify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marchandises_shopify" (
    "id" TEXT NOT NULL,
    "marchandise_id" TEXT NOT NULL,
    "boutique_id" TEXT NOT NULL,
    "id_produit_shopify" TEXT NOT NULL,
    "id_variante_shopify" TEXT NOT NULL,
    "sku" TEXT,
    "date_synchro" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marchandises_shopify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_shopify_recus" (
    "id" TEXT NOT NULL,
    "boutique_id" TEXT,
    "domaine" TEXT,
    "id_webhook" TEXT,
    "sujet" TEXT,
    "issue" TEXT NOT NULL,
    "reference" TEXT,
    "message" TEXT,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_shopify_recus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boutiques_shopify_marchand_id_key" ON "boutiques_shopify"("marchand_id");


-- CreateIndex
CREATE UNIQUE INDEX "boutiques_shopify_domaine_key" ON "boutiques_shopify"("domaine");


-- CreateIndex
CREATE UNIQUE INDEX "commandes_shopify_commande_id_key" ON "commandes_shopify"("commande_id");


-- CreateIndex
CREATE INDEX "commandes_shopify_boutique_id_idx" ON "commandes_shopify"("boutique_id");


-- CreateIndex
CREATE UNIQUE INDEX "commandes_shopify_boutique_id_id_commande_shopify_key" ON "commandes_shopify"("boutique_id", "id_commande_shopify");


-- CreateIndex
CREATE UNIQUE INDEX "marchandises_shopify_marchandise_id_key" ON "marchandises_shopify"("marchandise_id");


-- CreateIndex
CREATE INDEX "marchandises_shopify_boutique_id_idx" ON "marchandises_shopify"("boutique_id");


-- CreateIndex
CREATE UNIQUE INDEX "marchandises_shopify_boutique_id_id_variante_shopify_key" ON "marchandises_shopify"("boutique_id", "id_variante_shopify");


-- CreateIndex
CREATE INDEX "webhooks_shopify_recus_boutique_id_horodatage_idx" ON "webhooks_shopify_recus"("boutique_id", "horodatage");






-- AddForeignKey
ALTER TABLE "boutiques_shopify" ADD CONSTRAINT "boutiques_shopify_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "commandes_shopify" ADD CONSTRAINT "commandes_shopify_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "commandes_shopify" ADD CONSTRAINT "commandes_shopify_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_shopify"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "marchandises_shopify" ADD CONSTRAINT "marchandises_shopify_marchandise_id_fkey" FOREIGN KEY ("marchandise_id") REFERENCES "marchandises"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "marchandises_shopify" ADD CONSTRAINT "marchandises_shopify_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_shopify"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "webhooks_shopify_recus" ADD CONSTRAINT "webhooks_shopify_recus_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_shopify"("id") ON DELETE CASCADE ON UPDATE CASCADE;


