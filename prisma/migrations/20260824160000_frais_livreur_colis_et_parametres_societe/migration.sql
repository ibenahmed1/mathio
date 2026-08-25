-- 1. Rémunération du livreur figée COLIS PAR COLIS à la clôture de tournée,
--    et 2. identité de la société, jusqu'ici écrite en dur dans les pages
--    d'impression.

-- ============================================================
-- 1. Frais livreur par colis
-- ============================================================
ALTER TABLE "commandes"
  ADD COLUMN "frais_livreur" DECIMAL(10,2),
  ADD COLUMN "frais_livreur_livre" BOOLEAN;

-- Reprise de l'historique, sous condition de VÉRIFICATION.
--
-- Le montant par colis n'a jamais été stocké : il faut le reconstituer depuis
-- la grille tarifaire (TarifLivreurVille, à défaut les frais par défaut du
-- compte livreur). Or cette grille a pu changer depuis la clôture, et
-- réécrire le passé avec les tarifs d'aujourd'hui contredirait exactement la
-- garantie que `gain_livreur` a été figé pour offrir.
--
-- D'où le garde-fou : on ne reprend que les tournées dont la somme
-- reconstituée retombe AU CENTIME sur le `gain_livreur` figé. Si les deux
-- coïncident, c'est la preuve que les tarifs n'ont pas bougé depuis, et le
-- détail par colis est donc exact. Sinon les colonnes restent nulles et les
-- fiches de paie concernées afficheront « — » sur la colonne frais plutôt
-- qu'un montant inventé.
WITH frais_reconstitues AS (
  SELECT
    c.id AS commande_id,
    bd.id AS bon_distribution_id,
    c.statut = 'livre' AS livre,
    CASE
      WHEN c.statut = 'livre' THEN COALESCE(tlv."frais_livraison", u."frais_livraison", 0)
      ELSE COALESCE(tlv."frais_refus", u."frais_refus", 0)
    END AS montant
  FROM "commandes" c
  JOIN "bons_distribution" bd ON bd."id" = c."bon_distribution_id"
  JOIN "utilisateurs" u ON u."id" = bd."livreur_id"
  LEFT JOIN "tarifs_livreur_ville" tlv
    ON tlv."utilisateur_id" = bd."livreur_id" AND tlv."ville_id" = c."ville_id"
  WHERE bd."statut" = 'cloture'
    AND bd."gain_livreur" IS NOT NULL
    AND c."statut" IN ('livre', 'retourne_au_hub')
),
tournees_coherentes AS (
  SELECT f."bon_distribution_id"
  FROM frais_reconstitues f
  JOIN "bons_distribution" bd ON bd."id" = f."bon_distribution_id"
  GROUP BY f."bon_distribution_id", bd."gain_livreur"
  HAVING SUM(f."montant") = bd."gain_livreur"
)
UPDATE "commandes" c
SET "frais_livreur" = f."montant",
    "frais_livreur_livre" = f."livre"
FROM frais_reconstitues f
WHERE c."id" = f."commande_id"
  AND f."bon_distribution_id" IN (SELECT "bon_distribution_id" FROM tournees_coherentes);

-- ============================================================
-- 2. Paramètres de la société
-- ============================================================
CREATE TABLE "parametres_societe" (
    "id" TEXT NOT NULL DEFAULT 'societe',
    "raison_sociale" TEXT NOT NULL DEFAULT 'Mathio Delivery',
    "adresse" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "site_web" TEXT,
    "logo_url" TEXT,
    "date_maj" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametres_societe_pkey" PRIMARY KEY ("id")
);

-- La ligne unique est créée ici plutôt qu'au premier appel applicatif : les
-- pages d'impression sont en lecture seule et ne doivent pas avoir à écrire
-- en base pour s'afficher.
INSERT INTO "parametres_societe" ("id", "raison_sociale", "date_maj")
VALUES ('societe', 'Mathio Delivery', CURRENT_TIMESTAMP);
