-- Remise d'un colis à un prestataire par son API (§ Power Delivery) : deux
-- tables neuves, AUCUNE colonne ajoutée à une table existante. Voir
-- RemisePrestataire et EvenementPrestataire dans prisma/schema.prisma pour les
-- règles.
--
-- ⚠️ `prisma migrate dev` proposait aussi de supprimer puis recréer la clé
-- étrangère plateformes_partenaires.prestataire_id avec ON DELETE SET NULL :
-- c'est un écart PRÉEXISTANT entre le schéma et les migrations, sans rapport
-- avec ce lot. Il en a été retiré — le corriger ici changerait en silence le
-- comportement d'une contrainte en service. À traiter dans sa propre migration.

-- CreateEnum
CREATE TYPE "EtatRemisePrestataire" AS ENUM ('acceptee', 'refusee', 'a_confirmer', 'annulee');

-- CreateTable
CREATE TABLE "remises_prestataire" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "bon_envoi_id" TEXT,
    "remis_par_id" TEXT NOT NULL,
    "etat" "EtatRemisePrestataire" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "code_envoye" TEXT NOT NULL,
    "code_externe" TEXT,
    "city_id" INTEGER NOT NULL,
    "montant_cod_confie" DECIMAL(10,2) NOT NULL,
    "reponse_creation" JSONB,
    "erreur" TEXT,
    "dernier_statut_externe" TEXT,
    "dernier_paiement_externe" TEXT,
    "dernier_evenement_le" TIMESTAMP(3),
    "demande_retour_le" TIMESTAMP(3),
    "demande_relivraison_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remises_prestataire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evenements_prestataire" (
    "id" TEXT NOT NULL,
    "prestataire_id" TEXT NOT NULL,
    "remise_id" TEXT,
    "source" TEXT NOT NULL,
    "code_colis" TEXT,
    "statut_externe" TEXT,
    "statut_second" TEXT,
    "paiement_externe" TEXT,
    "charge" JSONB NOT NULL,
    "signature_valide" BOOLEAN,
    "issue" TEXT NOT NULL,
    "detail" TEXT,
    "recu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evenements_prestataire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remises_prestataire_commande_id_idx" ON "remises_prestataire"("commande_id");

-- CreateIndex
CREATE INDEX "remises_prestataire_prestataire_id_etat_idx" ON "remises_prestataire"("prestataire_id", "etat");

-- CreateIndex
CREATE INDEX "remises_prestataire_code_envoye_idx" ON "remises_prestataire"("code_envoye");

-- CreateIndex
CREATE INDEX "remises_prestataire_code_externe_idx" ON "remises_prestataire"("code_externe");

-- CreateIndex
CREATE INDEX "remises_prestataire_bon_envoi_id_idx" ON "remises_prestataire"("bon_envoi_id");

-- CreateIndex
CREATE INDEX "evenements_prestataire_prestataire_id_recu_le_idx" ON "evenements_prestataire"("prestataire_id", "recu_le");

-- CreateIndex
CREATE INDEX "evenements_prestataire_remise_id_idx" ON "evenements_prestataire"("remise_id");

-- AddForeignKey
ALTER TABLE "remises_prestataire" ADD CONSTRAINT "remises_prestataire_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remises_prestataire" ADD CONSTRAINT "remises_prestataire_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remises_prestataire" ADD CONSTRAINT "remises_prestataire_bon_envoi_id_fkey" FOREIGN KEY ("bon_envoi_id") REFERENCES "bons_envoi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remises_prestataire" ADD CONSTRAINT "remises_prestataire_remis_par_id_fkey" FOREIGN KEY ("remis_par_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evenements_prestataire" ADD CONSTRAINT "evenements_prestataire_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evenements_prestataire" ADD CONSTRAINT "evenements_prestataire_remise_id_fkey" FOREIGN KEY ("remise_id") REFERENCES "remises_prestataire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une seule remise ACTIVE par colis. Index PARTIEL, que Prisma ne sait pas
-- déclarer dans le schéma : il ne contraint que les lignes actives, si bien
-- qu'un colis garde tout l'historique de ses remises refusées ou annulées.
-- Sans lui, deux clics simultanés sur « Remettre » confieraient deux fois le
-- même colis — et la garantie doit être portée par la base, pas par un
-- contrôle « lire puis écrire » qui laisse la fenêtre ouverte.
CREATE UNIQUE INDEX "remises_prestataire_une_active_par_commande"
  ON "remises_prestataire"("commande_id") WHERE "active";
