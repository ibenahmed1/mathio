-- § Colis multi-produits : un colis contient une ou plusieurs lignes, chacune
-- désignant un produit (et sa variante), une marchandise, ou un article en
-- texte libre (cf. LigneColis dans schema.prisma). Ajout seul : les colonnes
-- produit_id / variante_id / marchandise_id de "commandes" restent en place
-- le temps que toute l'application écrive des lignes.

-- CreateTable
CREATE TABLE "lignes_colis" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "produit_id" TEXT,
    "variante_id" TEXT,
    "marchandise_id" TEXT,
    "sku" TEXT,
    "libelle" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,

    CONSTRAINT "lignes_colis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lignes_colis_commande_id_idx" ON "lignes_colis"("commande_id");

-- CreateIndex
CREATE INDEX "lignes_colis_produit_id_idx" ON "lignes_colis"("produit_id");

-- CreateIndex
CREATE INDEX "lignes_colis_variante_id_idx" ON "lignes_colis"("variante_id");

-- CreateIndex
CREATE INDEX "lignes_colis_marchandise_id_idx" ON "lignes_colis"("marchandise_id");

-- AddForeignKey
ALTER TABLE "lignes_colis" ADD CONSTRAINT "lignes_colis_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_colis" ADD CONSTRAINT "lignes_colis_produit_id_fkey" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_colis" ADD CONSTRAINT "lignes_colis_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "produit_variantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_colis" ADD CONSTRAINT "lignes_colis_marchandise_id_fkey" FOREIGN KEY ("marchandise_id") REFERENCES "marchandises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise : chaque colis existant devient UNE ligne, reprise de son produit
-- unique. Le libellé suit la priorité d'affichage actuelle (produit — variante,
-- puis marchandise, puis description libre) et le SKU est celui de l'unité de
-- stock. Un colis sans produit, sans marchandise ni description n'a aucun
-- contenu connu : il ne reçoit pas de ligne plutôt qu'une ligne inventée.
--
-- Les colis Shopify/YouCan à plusieurs articles avaient déjà été aplatis en
-- une description (« 2 × A, 1 × B ») : ils reprennent cette ligne unique, la
-- décomposition d'origine n'étant plus connue.
INSERT INTO "lignes_colis" ("id", "commande_id", "position", "produit_id", "variante_id", "marchandise_id", "sku", "libelle", "quantite")
SELECT
  gen_random_uuid()::text,
  c."id",
  0,
  c."produit_id",
  c."variante_id",
  c."marchandise_id",
  COALESCE(v."reference", p."reference"),
  COALESCE(
    CASE WHEN v."id" IS NOT NULL THEN p."nom_produit" || ' — ' || v."nom_variante" END,
    p."nom_produit",
    m."nom_marchandise",
    NULLIF(BTRIM(c."produit_description"), '')
  ),
  GREATEST(c."quantite", 1)
FROM "commandes" c
LEFT JOIN "produits" p ON p."id" = c."produit_id"
LEFT JOIN "produit_variantes" v ON v."id" = c."variante_id"
LEFT JOIN "marchandises" m ON m."id" = c."marchandise_id"
WHERE c."produit_id" IS NOT NULL
   OR c."marchandise_id" IS NOT NULL
   OR NULLIF(BTRIM(c."produit_description"), '') IS NOT NULL;
