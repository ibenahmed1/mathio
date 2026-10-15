-- Saisie des statuts par le transporteur depuis son espace (15/10/2026).
-- Ouverte par défaut (comportement actuel), coupée pour les quatre
-- transporteurs dont l'API nous renvoie déjà les statuts : leurs noms sont
-- ceux que le code utilise pour les retrouver (NOM_PRESTATAIRE_* dans
-- lib/remise-*.ts).
ALTER TABLE "prestataires" ADD COLUMN "saisie_statuts_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "prestataires"
SET "saisie_statuts_active" = false
WHERE "nom" IN ('Power Delivery', 'Colivraison', 'Meta Livraison', 'EST Livraison');
