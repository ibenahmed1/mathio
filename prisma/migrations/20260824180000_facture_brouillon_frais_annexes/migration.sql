-- Facturation marchand : la facture devient un document à CYCLE DE VIE
-- (brouillon → émise → payée), avec des frais annexes saisis à la main et la
-- traçabilité du reversement. Miroir exact de la refonte de la paie livreur
-- (20260824120000_paie_mensuelle_livreur), de l'autre côté du bilan.

-- ============================================================
-- 1. Statuts : ajout de `brouillon` en tête
-- ============================================================
-- Recréation du type plutôt qu'un ALTER TYPE ... ADD VALUE : l'ordre de
-- déclaration de l'enum est celui que Postgres utilise pour ORDER BY statut,
-- et `brouillon` doit précéder `emise` pour que le tri des factures suive le
-- cycle de vie plutôt que l'ordre d'ajout historique.
--
-- Correspondance des données existantes : toute facture déjà en base a été
-- créée par une émission délibérée (le brouillon n'existait pas), elle reste
-- donc `emise` — aucune ne doit rétrograder en brouillon.
ALTER TYPE "StatutFacture" RENAME TO "StatutFacture_old";

CREATE TYPE "StatutFacture" AS ENUM ('brouillon', 'emise', 'payee', 'annulee');

ALTER TABLE "factures" ALTER COLUMN "statut" DROP DEFAULT;

ALTER TABLE "factures"
  ALTER COLUMN "statut" TYPE "StatutFacture"
  USING ("statut"::text)::"StatutFacture";

ALTER TABLE "factures" ALTER COLUMN "statut" SET DEFAULT 'brouillon';

DROP TYPE "StatutFacture_old";

-- ============================================================
-- 2. Mode de règlement du marchand
-- ============================================================
-- Type distinct de "ModeReglementLivreur" bien que les trois valeurs
-- coïncident : les deux flux sont indépendants et rien ne garantit qu'ils
-- évolueront ensemble (cf. le commentaire de l'enum dans schema.prisma).
CREATE TYPE "ModeReglementMarchand" AS ENUM ('virement', 'especes', 'cheque');

-- ============================================================
-- 3. Frais annexes, validation et traçabilité du reversement
-- ============================================================
ALTER TABLE "factures"
  ADD COLUMN "total_autres_frais" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "date_validation" TIMESTAMP(3),
  ADD COLUMN "motif_annulation" TEXT,
  ADD COLUMN "mode_reglement" "ModeReglementMarchand",
  ADD COLUMN "reference_reglement" TEXT,
  ADD COLUMN "valide_par_id" TEXT;

-- Reprise des factures existantes : elles ont été figées au moment même de
-- leur création, `date_validation` vaut donc leur `date_emission`. Les
-- factures annulées ne sont PAS reprises — elles n'ont jamais été arrêtées au
-- sens du nouveau cycle, et leur attribuer une date de validation laisserait
-- croire qu'elles ont un jour valu créance.
UPDATE "factures"
SET "date_validation" = "date_emission"
WHERE "statut" <> 'annulee';

ALTER TABLE "factures"
  ADD CONSTRAINT "factures_valide_par_id_fkey"
  FOREIGN KEY ("valide_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. Lignes de frais annexes (emballage, réexpédition, service dédié)
-- ============================================================
CREATE TABLE "frais_facture" (
    "id" TEXT NOT NULL,
    "facture_id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "cree_par_id" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frais_facture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "frais_facture_facture_id_idx" ON "frais_facture"("facture_id");

-- ON DELETE CASCADE sur la facture : une facture supprimée n'a jamais lieu
-- d'être (on annule, on n'efface pas), mais si elle l'était, laisser des
-- lignes de frais orphelines fausserait tout total agrégé sur cette table.
ALTER TABLE "frais_facture"
  ADD CONSTRAINT "frais_facture_facture_id_fkey"
  FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "frais_facture"
  ADD CONSTRAINT "frais_facture_cree_par_id_fkey"
  FOREIGN KEY ("cree_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
