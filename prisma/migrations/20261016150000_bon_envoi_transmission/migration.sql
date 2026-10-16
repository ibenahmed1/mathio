-- « Marquer comme transmis » (16/10/2026) : date et auteur de la transmission
-- d'un bon d'envoi au transporteur.
ALTER TABLE "bons_envoi" ADD COLUMN "date_transmission" TIMESTAMP(3);
ALTER TABLE "bons_envoi" ADD COLUMN "transmis_par_id" TEXT;
