-- Retour déclaré par un transporteur vs retour reçu à notre hub (ajout seul).
ALTER TABLE "remises_prestataire" ADD COLUMN "retour_declare_le" TIMESTAMP(3);
ALTER TABLE "remises_prestataire" ADD COLUMN "retour_declare_code" TEXT;
ALTER TABLE "remises_prestataire" ADD COLUMN "retour_recu_le" TIMESTAMP(3);
