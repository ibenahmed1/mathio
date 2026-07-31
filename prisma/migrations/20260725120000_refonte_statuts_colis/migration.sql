-- Refonte du cycle de statut colis : remplace le pipeline logistique linéaire
-- (15 valeurs) par la liste détaillée façon centre d'appel (27 valeurs).
-- Postgres ne sait pas caster automatiquement l'ancien enum vers le nouveau
-- (les valeurs ne correspondent pas 1:1), donc on migre via une colonne
-- temporaire + un mapping explicite, plutôt que ALTER TYPE ... RENAME VALUE.

-- CreateEnum (nouveau jeu de valeurs)
CREATE TYPE "StatutCommande_new" AS ENUM (
    'nouveau_colis',
    'attente_de_ramassage',
    'ramasse',
    'recu',
    'expedie',
    'expedier_par_amana',
    'en_voyage',
    'mise_en_distribution',
    'livre',
    'en_cours',
    'boite_vocale',
    'deuxieme_appel_pas_reponse',
    'troisieme_appel_pas_reponse',
    'pas_de_reponse_sms',
    'injoignable',
    'numero_errone',
    'client_interesse',
    'relance_nouveau_client',
    'attente_de_relancer',
    'programme',
    'reporte',
    'hors_zone',
    'refuse',
    'retourne',
    'en_retour_par_amana',
    'annule',
    'annule_par_vendeur'
);

-- Migration des données "commandes.statut" (ancien -> nouveau)
ALTER TABLE "commandes" ADD COLUMN "statut_new" "StatutCommande_new";

UPDATE "commandes" SET "statut_new" = CASE "statut"::text
    WHEN 'en_attente' THEN 'nouveau_colis'
    WHEN 'confirmee' THEN 'attente_de_ramassage'
    WHEN 'collectee' THEN 'ramasse'
    WHEN 'recu_agence_depart' THEN 'recu'
    WHEN 'en_transit' THEN 'expedie'
    WHEN 'recu_agence_destination' THEN 'recu'
    WHEN 'mise_en_distribution' THEN 'mise_en_distribution'
    WHEN 'livree' THEN 'livre'
    WHEN 'recu_client' THEN 'livre'
    WHEN 'injoignable' THEN 'injoignable'
    WHEN 'refusee' THEN 'refuse'
    WHEN 'expedie_retour' THEN 'en_retour_par_amana'
    WHEN 'retour_centre' THEN 'en_retour_par_amana'
    WHEN 'retournee' THEN 'retourne'
    WHEN 'annulee' THEN 'annule'
    ELSE 'nouveau_colis'
END::"StatutCommande_new";

ALTER TABLE "commandes" ALTER COLUMN "statut_new" SET NOT NULL;
ALTER TABLE "commandes" ALTER COLUMN "statut_new" SET DEFAULT 'nouveau_colis';

ALTER TABLE "commandes" DROP COLUMN "statut";
ALTER TABLE "commandes" RENAME COLUMN "statut_new" TO "statut";

-- Migration des données "historique_statuts_commande" (ancien_statut nullable, nouveau_statut requis)
ALTER TABLE "historique_statuts_commande" ADD COLUMN "ancien_statut_new" "StatutCommande_new";
ALTER TABLE "historique_statuts_commande" ADD COLUMN "nouveau_statut_new" "StatutCommande_new";

UPDATE "historique_statuts_commande" SET "ancien_statut_new" = CASE "ancien_statut"::text
    WHEN 'en_attente' THEN 'nouveau_colis'
    WHEN 'confirmee' THEN 'attente_de_ramassage'
    WHEN 'collectee' THEN 'ramasse'
    WHEN 'recu_agence_depart' THEN 'recu'
    WHEN 'en_transit' THEN 'expedie'
    WHEN 'recu_agence_destination' THEN 'recu'
    WHEN 'mise_en_distribution' THEN 'mise_en_distribution'
    WHEN 'livree' THEN 'livre'
    WHEN 'recu_client' THEN 'livre'
    WHEN 'injoignable' THEN 'injoignable'
    WHEN 'refusee' THEN 'refuse'
    WHEN 'expedie_retour' THEN 'en_retour_par_amana'
    WHEN 'retour_centre' THEN 'en_retour_par_amana'
    WHEN 'retournee' THEN 'retourne'
    WHEN 'annulee' THEN 'annule'
    ELSE NULL
END::"StatutCommande_new";

UPDATE "historique_statuts_commande" SET "nouveau_statut_new" = CASE "nouveau_statut"::text
    WHEN 'en_attente' THEN 'nouveau_colis'
    WHEN 'confirmee' THEN 'attente_de_ramassage'
    WHEN 'collectee' THEN 'ramasse'
    WHEN 'recu_agence_depart' THEN 'recu'
    WHEN 'en_transit' THEN 'expedie'
    WHEN 'recu_agence_destination' THEN 'recu'
    WHEN 'mise_en_distribution' THEN 'mise_en_distribution'
    WHEN 'livree' THEN 'livre'
    WHEN 'recu_client' THEN 'livre'
    WHEN 'injoignable' THEN 'injoignable'
    WHEN 'refusee' THEN 'refuse'
    WHEN 'expedie_retour' THEN 'en_retour_par_amana'
    WHEN 'retour_centre' THEN 'en_retour_par_amana'
    WHEN 'retournee' THEN 'retourne'
    WHEN 'annulee' THEN 'annule'
    ELSE 'nouveau_colis'
END::"StatutCommande_new";

ALTER TABLE "historique_statuts_commande" ALTER COLUMN "nouveau_statut_new" SET NOT NULL;

ALTER TABLE "historique_statuts_commande" DROP COLUMN "ancien_statut";
ALTER TABLE "historique_statuts_commande" DROP COLUMN "nouveau_statut";
ALTER TABLE "historique_statuts_commande" RENAME COLUMN "ancien_statut_new" TO "ancien_statut";
ALTER TABLE "historique_statuts_commande" RENAME COLUMN "nouveau_statut_new" TO "nouveau_statut";

-- Bascule de l'enum
DROP TYPE "StatutCommande";
ALTER TYPE "StatutCommande_new" RENAME TO "StatutCommande";

-- AlterEnum (paiement)
ALTER TYPE "EtatPaiement" ADD VALUE 'rembourse';

-- AlterTable (livreur assigné, CIN)
ALTER TABLE "commandes" ADD COLUMN "livreur_id" TEXT;
ALTER TABLE "commandes" ADD COLUMN "cin_url" TEXT;

CREATE INDEX "commandes_livreur_id_idx" ON "commandes"("livreur_id");

ALTER TABLE "commandes" ADD CONSTRAINT "commandes_livreur_id_fkey" FOREIGN KEY ("livreur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable (commentaires internes sur un colis)
CREATE TABLE "commentaires_commande" (
    "id" TEXT NOT NULL,
    "commande_id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commentaires_commande_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commentaires_commande_commande_id_idx" ON "commentaires_commande"("commande_id");

ALTER TABLE "commentaires_commande" ADD CONSTRAINT "commentaires_commande_commande_id_fkey" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commentaires_commande" ADD CONSTRAINT "commentaires_commande_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
