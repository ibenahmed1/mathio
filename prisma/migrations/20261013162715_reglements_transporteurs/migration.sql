-- § Règlements transporteurs (13/10/2026, SOUS_TRAITANCE.md) : créance par colis
-- livré confié à un transporteur, versements reçus, catégorie comptable système.

-- CreateEnum
CREATE TYPE "EtatCreanceTransporteur" AS ENUM ('a_recevoir', 'paye', 'annulee');

-- CreateTable
CREATE TABLE "creances_transporteurs" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "montant_cod" DECIMAL(10,2) NOT NULL,
    "frais_transporteur" DECIMAL(10,2),
    "montant_attendu" DECIMAL(10,2) NOT NULL,
    "date_livraison" TIMESTAMP(3) NOT NULL,
    "echeance" TIMESTAMP(3) NOT NULL,
    "etat" "EtatCreanceTransporteur" NOT NULL DEFAULT 'a_recevoir',
    "versement_id" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creances_transporteurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versements_transporteurs" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "montant_recu" DECIMAL(12,2) NOT NULL,
    "montant_attendu" DECIMAL(12,2) NOT NULL,
    "date_versement" TIMESTAMP(3) NOT NULL,
    "preuve_url" TEXT,
    "note" TEXT,
    "auteur_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "annule_le" TIMESTAMP(3),
    "annule_par_id" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versements_transporteurs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creances_transporteurs_commande_id_key" ON "creances_transporteurs"("commande_id");

-- CreateIndex
CREATE INDEX "creances_transporteurs_prestataire_id_etat_idx" ON "creances_transporteurs"("prestataire_id", "etat");

-- CreateIndex
CREATE INDEX "creances_transporteurs_versement_id_idx" ON "creances_transporteurs"("versement_id");

-- CreateIndex
CREATE UNIQUE INDEX "versements_transporteurs_numero_key" ON "versements_transporteurs"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "versements_transporteurs_transaction_id_key" ON "versements_transporteurs"("transaction_id");

-- CreateIndex
CREATE INDEX "versements_transporteurs_prestataire_id_idx" ON "versements_transporteurs"("prestataire_id");

-- AddForeignKey
ALTER TABLE "creances_transporteurs" ADD CONSTRAINT "creances_transporteurs_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creances_transporteurs" ADD CONSTRAINT "creances_transporteurs_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creances_transporteurs" ADD CONSTRAINT "creances_transporteurs_versement_id_fkey" FOREIGN KEY ("versement_id") REFERENCES "versements_transporteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versements_transporteurs" ADD CONSTRAINT "versements_transporteurs_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versements_transporteurs" ADD CONSTRAINT "versements_transporteurs_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versements_transporteurs" ADD CONSTRAINT "versements_transporteurs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versements_transporteurs" ADD CONSTRAINT "versements_transporteurs_annule_par_id_fkey" FOREIGN KEY ("annule_par_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Catégorie système des encaissements de transporteurs (code référencé par
-- lib/reglements-transporteurs.ts) : elle se renomme, elle ne se supprime pas.
-- Une catégorie de la plateforme déjà nommée ainsi (créée à la main) reçoit le code ;
-- sinon elle est créée.
UPDATE "categories_comptables" SET "code" = 'encaissement_transporteur'
WHERE "marchand_id" IS NULL AND "portee" = 'transaction' AND "nom" = 'Encaissement transporteur' AND "code" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "categories_comptables" WHERE "code" = 'encaissement_transporteur');

INSERT INTO "categories_comptables" ("id", "nom", "portee", "code")
SELECT gen_random_uuid(), 'Encaissement transporteur', 'transaction', 'encaissement_transporteur'
WHERE NOT EXISTS (SELECT 1 FROM "categories_comptables" WHERE "code" = 'encaissement_transporteur');
