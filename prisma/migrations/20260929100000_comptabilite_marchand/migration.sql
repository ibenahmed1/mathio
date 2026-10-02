-- § Comptabilité de la boutique (/marchand/comptabilite) : les quatre tables
-- de la comptabilité gagnent un propriétaire facultatif. Les lignes existantes
-- restent à NULL, c'est-à-dire dans les livres de la plateforme — rien ne
-- change pour elles.

ALTER TABLE "transactions" ADD COLUMN "marchand_id" TEXT;
ALTER TABLE "commandes_stock_hub" ADD COLUMN "marchand_id" TEXT;
ALTER TABLE "categories_comptables" ADD COLUMN "marchand_id" TEXT;
ALTER TABLE "historique_comptable" ADD COLUMN "marchand_id" TEXT;

-- Unicité des catégories : par livre désormais.
DROP INDEX "categories_comptables_portee_nom_key";
CREATE UNIQUE INDEX "categories_comptables_marchand_id_portee_nom_key" ON "categories_comptables"("marchand_id", "portee", "nom");

CREATE INDEX "transactions_marchand_id_idx" ON "transactions"("marchand_id");
CREATE INDEX "commandes_stock_hub_marchand_id_idx" ON "commandes_stock_hub"("marchand_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commandes_stock_hub" ADD CONSTRAINT "commandes_stock_hub_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories_comptables" ADD CONSTRAINT "categories_comptables_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "historique_comptable" ADD CONSTRAINT "historique_comptable_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
