-- § Intégration YouCan : quatre tables satellites, AUCUNE colonne ajoutée sur
-- commandes, marchandises ni marchands (cf. prisma/schema.prisma).

-- CreateTable
CREATE TABLE "boutiques_youcan" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "slug" TEXT,
    "domaine" TEXT,
    "nom" TEXT,
    "devise" TEXT,
    "jeton_acces_chiffre" TEXT NOT NULL,
    "jeton_rafraichissement_chiffre" TEXT NOT NULL,
    "jeton_expire_le" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT,
    "webhook_commandes_id" TEXT,
    "webhook_desinstall_id" TEXT,
    "webhook_uri" TEXT,
    "connectee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deconnectee_le" TIMESTAMP(3),
    "derniere_synchro_produits_le" TIMESTAMP(3),
    "derniere_erreur" TEXT,
    "date_maj" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boutiques_youcan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commandes_youcan" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "boutique_id" TEXT NOT NULL,
    "id_commande_youcan" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "devise" TEXT,
    "date_reception" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commandes_youcan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marchandises_youcan" (
    "id" TEXT NOT NULL,
    "marchandise_id" TEXT NOT NULL,
    "boutique_id" TEXT NOT NULL,
    "id_produit_youcan" TEXT NOT NULL,
    "id_variante_youcan" TEXT NOT NULL,
    "sku" TEXT,
    "date_synchro" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marchandises_youcan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_youcan_recus" (
    "id" TEXT NOT NULL,
    "boutique_id" TEXT,
    "store_id" TEXT,
    "id_livraison" TEXT,
    "sujet" TEXT,
    "issue" TEXT NOT NULL,
    "reference" TEXT,
    "message" TEXT,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_youcan_recus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boutiques_youcan_marchand_id_key" ON "boutiques_youcan"("marchand_id");

-- CreateIndex
CREATE UNIQUE INDEX "boutiques_youcan_store_id_key" ON "boutiques_youcan"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "commandes_youcan_commande_id_key" ON "commandes_youcan"("commande_id");

-- CreateIndex
CREATE INDEX "commandes_youcan_boutique_id_idx" ON "commandes_youcan"("boutique_id");

-- CreateIndex
CREATE UNIQUE INDEX "commandes_youcan_boutique_id_id_commande_youcan_key" ON "commandes_youcan"("boutique_id", "id_commande_youcan");

-- CreateIndex
CREATE UNIQUE INDEX "marchandises_youcan_marchandise_id_key" ON "marchandises_youcan"("marchandise_id");

-- CreateIndex
CREATE INDEX "marchandises_youcan_boutique_id_idx" ON "marchandises_youcan"("boutique_id");

-- CreateIndex
CREATE UNIQUE INDEX "marchandises_youcan_boutique_id_id_variante_youcan_key" ON "marchandises_youcan"("boutique_id", "id_variante_youcan");

-- CreateIndex
CREATE INDEX "webhooks_youcan_recus_boutique_id_horodatage_idx" ON "webhooks_youcan_recus"("boutique_id", "horodatage");

-- AddForeignKey
ALTER TABLE "boutiques_youcan" ADD CONSTRAINT "boutiques_youcan_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes_youcan" ADD CONSTRAINT "commandes_youcan_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes_youcan" ADD CONSTRAINT "commandes_youcan_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_youcan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marchandises_youcan" ADD CONSTRAINT "marchandises_youcan_marchandise_id_fkey" FOREIGN KEY ("marchandise_id") REFERENCES "marchandises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marchandises_youcan" ADD CONSTRAINT "marchandises_youcan_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_youcan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks_youcan_recus" ADD CONSTRAINT "webhooks_youcan_recus_boutique_id_fkey" FOREIGN KEY ("boutique_id") REFERENCES "boutiques_youcan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
