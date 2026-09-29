-- Comptabilité modifiable (§ /admin/comptabilite) : titre des écritures,
-- catégories tenues en base, suppression logique et historique des
-- manipulations. Voir Transaction, CategorieComptable et HistoriqueComptable
-- dans prisma/schema.prisma pour les règles.
--
-- L'ordre compte : la catégorie d'une écriture passe d'un enum à une clé
-- étrangère, et chaque écriture existante doit retrouver la sienne AVANT que
-- l'ancienne colonne ne disparaisse. Même démarche que les étiquettes de
-- tâche (20260901120000_etiquettes_taches_dynamiques).

-- CreateEnum
CREATE TYPE "PorteeCategorieComptable" AS ENUM ('transaction', 'commande_stock_hub');
CREATE TYPE "CibleHistoriqueComptable" AS ENUM ('transaction', 'commande_stock_hub', 'categorie');
CREATE TYPE "ActionHistoriqueComptable" AS ENUM ('creation', 'modification', 'suppression', 'restauration');

-- CreateTable
CREATE TABLE "categories_comptables" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "portee" "PorteeCategorieComptable" NOT NULL,
    "code" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_comptables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_comptables_code_key" ON "categories_comptables"("code");
CREATE UNIQUE INDEX "categories_comptables_portee_nom_key" ON "categories_comptables"("portee", "nom");

-- Reprise des six valeurs de l'ancien enum, avec les libellés que l'écran
-- affichait déjà (lib/finance.ts). Le `code` reprend la valeur d'enum : c'est
-- par lui que les écritures existantes retrouvent leur catégorie ci-dessous.
INSERT INTO "categories_comptables" ("id", "nom", "portee", "code") VALUES
  (gen_random_uuid(), 'Paiement client',    'transaction', 'paiement_client'),
  (gen_random_uuid(), 'Frais de livraison', 'transaction', 'frais_livraison'),
  (gen_random_uuid(), 'Abonnement outil',   'transaction', 'abonnement_outil'),
  (gen_random_uuid(), 'Salaire',            'transaction', 'salaire'),
  (gen_random_uuid(), 'Remboursement',      'transaction', 'remboursement'),
  (gen_random_uuid(), 'Autre',              'transaction', 'autre');

-- Écritures : colonnes ajoutées nullables, remplies, PUIS contraintes.
ALTER TABLE "transactions"
ADD COLUMN "titre" TEXT,
ADD COLUMN "categorie_id" TEXT,
ADD COLUMN "supprime_le" TIMESTAMP(3),
ADD COLUMN "supprime_par_id" TEXT;

UPDATE "transactions" t
SET "categorie_id" = c."id"
FROM "categories_comptables" c
WHERE c."code" = t."categorie"::text;

-- Titre des écritures existantes, dérivé de leur ORIGINE quand elle est
-- connue — c'est l'information que le journal n'affichait nulle part — et
-- du libellé de la catégorie sinon. La description d'origine est laissée
-- intacte : elle garde le détail.
UPDATE "transactions" t SET "titre" = 'Remise de caisse ' || b."numero"
FROM "bons_distribution" b WHERE b."transaction_id" = t."id";

UPDATE "transactions" t SET "titre" = 'Règlement facture ' || f."numero"
FROM "factures" f WHERE f."transaction_id" = t."id" AND t."titre" IS NULL;

UPDATE "transactions" t SET "titre" = 'Paie ' || p."numero"
FROM "bons_paiement" p WHERE p."transaction_id" = t."id" AND t."titre" IS NULL;

UPDATE "transactions" SET "titre" = 'Annulation'
WHERE "transaction_origine_id" IS NOT NULL AND "titre" IS NULL;

UPDATE "transactions" t SET "titre" = c."nom"
FROM "categories_comptables" c
WHERE c."id" = t."categorie_id" AND t."titre" IS NULL;

ALTER TABLE "transactions"
ALTER COLUMN "titre" SET NOT NULL,
ALTER COLUMN "categorie_id" SET NOT NULL;

DROP INDEX "transactions_categorie_idx";
ALTER TABLE "transactions" DROP COLUMN "categorie";
DROP TYPE "CategorieTransaction";

-- Seules les deux catégories que le code référence (écritures automatiques,
-- cf. CODES_CATEGORIE_SYSTEME dans lib/finance.ts) gardent leur code, et
-- avec lui leur protection contre la suppression. Les quatre autres
-- deviennent des catégories ordinaires, que l'admin peut supprimer une fois
-- qu'aucune écriture ne les porte plus.
UPDATE "categories_comptables" SET "code" = NULL
WHERE "code" NOT IN ('paiement_client', 'salaire');

CREATE INDEX "transactions_categorie_id_idx" ON "transactions"("categorie_id");
CREATE INDEX "transactions_supprime_le_idx" ON "transactions"("supprime_le");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_categorie_id_fkey" FOREIGN KEY ("categorie_id") REFERENCES "categories_comptables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_supprime_par_id_fkey" FOREIGN KEY ("supprime_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Commandes d'inventaire : catégorie facultative (aucune n'est inventée pour
-- les commandes existantes), suppression logique.
ALTER TABLE "commandes_stock_hub"
ADD COLUMN "categorie_id" TEXT,
ADD COLUMN "supprime_le" TIMESTAMP(3),
ADD COLUMN "supprime_par_id" TEXT;

CREATE INDEX "commandes_stock_hub_supprime_le_idx" ON "commandes_stock_hub"("supprime_le");

ALTER TABLE "commandes_stock_hub" ADD CONSTRAINT "commandes_stock_hub_categorie_id_fkey" FOREIGN KEY ("categorie_id") REFERENCES "categories_comptables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commandes_stock_hub" ADD CONSTRAINT "commandes_stock_hub_supprime_par_id_fkey" FOREIGN KEY ("supprime_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "historique_comptable" (
    "id" TEXT NOT NULL,
    "cible_type" "CibleHistoriqueComptable" NOT NULL,
    "cible_id" TEXT NOT NULL,
    "action" "ActionHistoriqueComptable" NOT NULL,
    "avant" JSONB,
    "apres" JSONB,
    "auteur_id" TEXT NOT NULL,
    "date_action" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_comptable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "historique_comptable_cible_type_cible_id_idx" ON "historique_comptable"("cible_type", "cible_id");

ALTER TABLE "historique_comptable" ADD CONSTRAINT "historique_comptable_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permissions `comptabilite:edit` et `comptabilite:delete` (§ lib/permissions.ts) :
-- modifier, supprimer et restaurer une pièce comptable, gérer les catégories.
-- Accordées au seul rôle `admin` par décision métier : le responsable garde
-- la saisie et l'annulation (`comptabilite:write`), qui laissent une trace
-- dans le journal lui-même.
--
-- CONCATÉNATION (`||`), même convention que 20260902103100_permission_integrations :
-- l'admin détient déjà le catalogue entier à l'exécution (effectivePermissions),
-- ce remplissage remet seulement la colonne stockée d'accord avec le code.
UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'comptabilite:edit',
  'comptabilite:delete'
] WHERE "role" = 'admin';
