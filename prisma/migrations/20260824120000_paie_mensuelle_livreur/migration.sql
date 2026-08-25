-- Paie mensuelle du livreur : le bon de paiement devient un document de
-- PÉRIODE (1er → dernier jour du mois) avec un cycle brouillon → validé →
-- payé, des ajustements (primes/pénalités) et une traçabilité du décaissement.

-- ============================================================
-- 1. Statuts : emis/regle -> brouillon/valide/paye/annule
-- ============================================================
-- Correspondance des données existantes : un bon `emis` était le résultat
-- d'une émission manuelle et délibérée, il correspond donc à `valide` (montant
-- arrêté, en attente de décaissement) et non à `brouillon`.
ALTER TYPE "StatutBonPaiement" RENAME TO "StatutBonPaiement_old";

CREATE TYPE "StatutBonPaiement" AS ENUM ('brouillon', 'valide', 'paye', 'annule');

ALTER TABLE "bons_paiement" ALTER COLUMN "statut" DROP DEFAULT;

ALTER TABLE "bons_paiement"
  ALTER COLUMN "statut" TYPE "StatutBonPaiement"
  USING (
    CASE "statut"::text
      WHEN 'emis' THEN 'valide'
      WHEN 'regle' THEN 'paye'
      ELSE 'brouillon'
    END
  )::"StatutBonPaiement";

ALTER TABLE "bons_paiement" ALTER COLUMN "statut" SET DEFAULT 'brouillon';

DROP TYPE "StatutBonPaiement_old";

-- ============================================================
-- 2. Nouveaux types
-- ============================================================
CREATE TYPE "ModeReglementLivreur" AS ENUM ('virement', 'especes', 'cheque');

CREATE TYPE "TypeAjustementPaiement" AS ENUM ('prime', 'penalite');

-- ============================================================
-- 3. Période de paie, ajustements et traçabilité du décaissement
-- ============================================================
ALTER TABLE "bons_paiement"
  ADD COLUMN "periode_debut" TIMESTAMP(3),
  ADD COLUMN "periode_fin" TIMESTAMP(3),
  ADD COLUMN "montant_commissions" DECIMAL(12,2),
  ADD COLUMN "total_ajustements" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "date_validation" TIMESTAMP(3),
  ADD COLUMN "date_annulation" TIMESTAMP(3),
  ADD COLUMN "motif_annulation" TEXT,
  ADD COLUMN "mode_reglement" "ModeReglementLivreur",
  ADD COLUMN "reference_reglement" TEXT,
  ADD COLUMN "valide_par_id" TEXT;

-- Reprise des bons existants : ils n'avaient pas de période, on leur attribue
-- le mois civil de leur génération, et leurs commissions valent leur total
-- (aucun ajustement n'existait avant cette migration).
UPDATE "bons_paiement" SET
  "periode_debut" = date_trunc('month', "date_generation"),
  "periode_fin" = date_trunc('month', "date_generation") + INTERVAL '1 month' - INTERVAL '1 millisecond',
  "montant_commissions" = "montant_total";

ALTER TABLE "bons_paiement"
  ALTER COLUMN "periode_debut" SET NOT NULL,
  ALTER COLUMN "periode_fin" SET NOT NULL,
  ALTER COLUMN "montant_commissions" SET NOT NULL;

CREATE INDEX "bons_paiement_periode_debut_idx" ON "bons_paiement"("periode_debut");

ALTER TABLE "bons_paiement"
  ADD CONSTRAINT "bons_paiement_valide_par_id_fkey"
  FOREIGN KEY ("valide_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. Lignes d'ajustement (prime / pénalité)
-- ============================================================
CREATE TABLE "ajustements_bon_paiement" (
    "id" TEXT NOT NULL,
    "bon_paiement_id" TEXT NOT NULL,
    "type" "TypeAjustementPaiement" NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "cree_par_id" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajustements_bon_paiement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ajustements_bon_paiement_bon_paiement_id_idx" ON "ajustements_bon_paiement"("bon_paiement_id");

ALTER TABLE "ajustements_bon_paiement"
  ADD CONSTRAINT "ajustements_bon_paiement_bon_paiement_id_fkey"
  FOREIGN KEY ("bon_paiement_id") REFERENCES "bons_paiement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ajustements_bon_paiement"
  ADD CONSTRAINT "ajustements_bon_paiement_cree_par_id_fkey"
  FOREIGN KEY ("cree_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
