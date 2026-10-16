-- Bon d'envoi exceptionnel (décision du 16/10/2026) : colis confiés à un
-- transporteur hors des règles de routage, avec motif et auteur.
ALTER TABLE "bons_envoi" ADD COLUMN "exceptionnel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bons_envoi" ADD COLUMN "motif_exceptionnel" TEXT;
ALTER TABLE "bons_envoi" ADD COLUMN "cree_par_id" TEXT;

ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_cree_par_id_fkey"
  FOREIGN KEY ("cree_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
