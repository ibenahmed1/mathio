-- § Intégration YouCan : chaque marchand saisit les identifiants de SA
-- propre application YouCan (comme Shopify) au lieu de celle de la plateforme.
ALTER TABLE "boutiques_youcan" ADD COLUMN "client_id" TEXT,
ADD COLUMN "client_secret_chiffre" TEXT;
