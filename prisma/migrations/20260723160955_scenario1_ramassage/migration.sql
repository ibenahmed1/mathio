-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'finance', 'sav', 'agent_confirmation', 'marchand', 'livreur', 'ramasseur');

-- CreateEnum
CREATE TYPE "TypeCompteMarchand" AS ENUM ('marchand', 'entreprise', 'dropshipping');

-- CreateEnum
CREATE TYPE "StatutMarchand" AS ENUM ('en_attente_validation', 'actif', 'suspendu');

-- CreateEnum
CREATE TYPE "StatutCommande" AS ENUM ('en_attente', 'confirmee', 'collectee', 'en_transit', 'livree', 'retournee', 'annulee');

-- CreateEnum
CREATE TYPE "SourceCommande" AS ENUM ('manuel', 'import_csv', 'api');

-- CreateEnum
CREATE TYPE "StatutRamassage" AS ENUM ('en_attente', 'confirmee', 'effectuee', 'annulee');

-- CreateEnum
CREATE TYPE "ModeCreationRamassage" AS ENUM ('recurrent', 'manuel');

-- CreateEnum
CREATE TYPE "TypeListeNoire" AS ENUM ('telephone', 'client', 'adresse');

-- CreateEnum
CREATE TYPE "MotifListeNoire" AS ENUM ('fraude', 'refus_repetitifs', 'faux_numero', 'client_agressif', 'impaye', 'autre');

-- CreateEnum
CREATE TYPE "NiveauRisque" AS ENUM ('moyen', 'eleve', 'critique');

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" TEXT NOT NULL,
    "nom_complet" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "email" TEXT,
    "mot_de_passe_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniere_connexion" TIMESTAMP(3),

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marchands" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "nom_boutique" TEXT NOT NULL,
    "raison_sociale" TEXT,
    "ice_rc" TEXT,
    "type_compte" "TypeCompteMarchand" NOT NULL DEFAULT 'marchand',
    "ville" TEXT,
    "rib" TEXT,
    "statut" "StatutMarchand" NOT NULL DEFAULT 'en_attente_validation',
    "ramassage_recurrent_actif" BOOLEAN NOT NULL DEFAULT false,
    "ramassage_jours" TEXT,
    "ramassage_creneau_horaire" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marchands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adresses_marchand" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "adresse_complete" TEXT NOT NULL,
    "est_par_defaut" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "adresses_marchand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commandes" (
    "id" TEXT NOT NULL,
    "code_suivi" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "client_nom" TEXT NOT NULL,
    "client_telephone" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "code_postal" TEXT,
    "produit_description" TEXT,
    "quantite" INTEGER NOT NULL DEFAULT 1,
    "poids_kg" DECIMAL(6,2),
    "montant_cod" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "statut" "StatutCommande" NOT NULL DEFAULT 'en_attente',
    "a_risque" BOOLEAN NOT NULL DEFAULT false,
    "ramasseur_id" TEXT,
    "ramassage_id" TEXT,
    "source" "SourceCommande" NOT NULL DEFAULT 'manuel',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_confirmation" TIMESTAMP(3),
    "date_collecte" TIMESTAMP(3),
    "date_livraison" TIMESTAMP(3),
    "gps_livraison_lat" DECIMAL(9,6),
    "gps_livraison_lng" DECIMAL(9,6),
    "signature_url" TEXT,
    "photo_preuve_url" TEXT,
    "motif_retour" TEXT,

    CONSTRAINT "commandes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historique_statuts_commande" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "ancien_statut" "StatutCommande",
    "nouveau_statut" "StatutCommande" NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_statuts_commande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ramassages" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "adresse_id" TEXT NOT NULL,
    "date_prevue" DATE NOT NULL,
    "creneau_horaire" TEXT,
    "mode_creation" "ModeCreationRamassage" NOT NULL,
    "initie_par" TEXT,
    "nb_colis_estimes" INTEGER,
    "nb_colis_reels" INTEGER NOT NULL DEFAULT 0,
    "ramasseur_id" TEXT,
    "statut" "StatutRamassage" NOT NULL DEFAULT 'en_attente',

    CONSTRAINT "ramassages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liste_noire" (
    "id" TEXT NOT NULL,
    "type" "TypeListeNoire" NOT NULL,
    "valeur" TEXT NOT NULL,
    "nom_associe" TEXT,
    "motif" "MotifListeNoire" NOT NULL,
    "niveau_risque" "NiveauRisque" NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liste_noire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produits" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "prix_unitaire" DECIMAL(10,2) NOT NULL,
    "seuil_alerte" INTEGER NOT NULL DEFAULT 5,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_telephone_key" ON "utilisateurs"("telephone");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_email_key" ON "utilisateurs"("email");

-- CreateIndex
CREATE UNIQUE INDEX "marchands_utilisateur_id_key" ON "marchands"("utilisateur_id");

-- CreateIndex
CREATE INDEX "adresses_marchand_marchand_id_idx" ON "adresses_marchand"("marchand_id");

-- CreateIndex
CREATE UNIQUE INDEX "commandes_code_suivi_key" ON "commandes"("code_suivi");

-- CreateIndex
CREATE INDEX "commandes_marchand_id_idx" ON "commandes"("marchand_id");

-- CreateIndex
CREATE INDEX "commandes_statut_idx" ON "commandes"("statut");

-- CreateIndex
CREATE INDEX "commandes_ramassage_id_idx" ON "commandes"("ramassage_id");

-- CreateIndex
CREATE INDEX "historique_statuts_commande_commande_id_idx" ON "historique_statuts_commande"("commande_id");

-- CreateIndex
CREATE INDEX "ramassages_marchand_id_date_prevue_idx" ON "ramassages"("marchand_id", "date_prevue");

-- CreateIndex
CREATE INDEX "liste_noire_type_valeur_idx" ON "liste_noire"("type", "valeur");

-- CreateIndex
CREATE UNIQUE INDEX "produits_sku_key" ON "produits"("sku");

-- AddForeignKey
ALTER TABLE "marchands" ADD CONSTRAINT "marchands_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adresses_marchand" ADD CONSTRAINT "adresses_marchand_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_ramasseur_id_fkey" FOREIGN KEY ("ramasseur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_ramassage_id_fkey" FOREIGN KEY ("ramassage_id") REFERENCES "ramassages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_statuts_commande" ADD CONSTRAINT "historique_statuts_commande_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_statuts_commande" ADD CONSTRAINT "historique_statuts_commande_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ramassages" ADD CONSTRAINT "ramassages_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ramassages" ADD CONSTRAINT "ramassages_adresse_id_fkey" FOREIGN KEY ("adresse_id") REFERENCES "adresses_marchand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ramassages" ADD CONSTRAINT "ramassages_initie_par_fkey" FOREIGN KEY ("initie_par") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ramassages" ADD CONSTRAINT "ramassages_ramasseur_id_fkey" FOREIGN KEY ("ramasseur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RG-01: le code de suivi est généré par une séquence serveur, jamais par un
-- horodatage ou un compteur côté client.
CREATE SEQUENCE "commande_code_seq" START WITH 100000;
