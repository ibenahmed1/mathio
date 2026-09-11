-- Une commande d'inventaire naît en brouillon (cf. migration précédente, qui a
-- créé la valeur : elle ne pouvait pas servir de défaut dans la même
-- transaction).
ALTER TABLE "commandes_stock_hub" ALTER COLUMN "statut" SET DEFAULT 'brouillon';
