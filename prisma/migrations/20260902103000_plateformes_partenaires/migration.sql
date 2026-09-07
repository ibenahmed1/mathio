-- Plateformes partenaires — flux ENTRANT (§ intégration Shipeh).
--
-- Quatre tables satellites et un rôle : ni `commandes`, ni `marchands`, ni
-- `utilisateurs` ne reçoivent de colonne. L'idempotence de l'ingestion des
-- colis repose sur une contrainte qui existe DÉJÀ
-- (commandes_marchand_ref_partenaire_key), pas sur du code.
--
-- Le rôle `plateforme` n'est porté que par les comptes de service, et
-- n'appartient à AUCUN espace applicatif (SPACE_ROLES / SPACE_LOGIN_ROLES,
-- lib/auth.ts) : aucun domaine ne peut lui ouvrir de session. Voir
-- prisma/schema.prisma pour le raisonnement complet.

-- CreateEnum
CREATE TYPE "EnvironnementApi" AS ENUM ('live', 'test');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'plateforme';

-- CreateTable
CREATE TABLE "plateformes_partenaires" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "utilisateur_technique_id" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plateformes_partenaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cles_api_plateforme" (
    "id" TEXT NOT NULL,
    "plateforme_id" TEXT NOT NULL,
    "prefixe" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "environnement" "EnvironnementApi" NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "libelle" TEXT,
    "quota_par_minute" INTEGER NOT NULL DEFAULT 600,
    "creee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expire_le" TIMESTAMP(3),
    "revoquee_le" TIMESTAMP(3),
    "derniere_utilisation_le" TIMESTAMP(3),
    "nb_appels" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cles_api_plateforme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comptes_marchands_externes" (
    "id" TEXT NOT NULL,
    "plateforme_id" TEXT NOT NULL,
    "id_externe" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "environnement" "EnvironnementApi" NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_synchro" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comptes_marchands_externes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_appels_api" (
    "id" TEXT NOT NULL,
    "plateforme_id" TEXT NOT NULL,
    "cle_id" TEXT,
    "methode" TEXT NOT NULL,
    "chemin" TEXT NOT NULL,
    "statut" INTEGER NOT NULL,
    "duree_ms" INTEGER,
    "adresse_ip" TEXT,
    "reference" TEXT,
    "erreur" TEXT,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_appels_api_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plateformes_partenaires_code_key" ON "plateformes_partenaires"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plateformes_partenaires_utilisateur_technique_id_key" ON "plateformes_partenaires"("utilisateur_technique_id");

-- CreateIndex
CREATE UNIQUE INDEX "cles_api_plateforme_prefixe_key" ON "cles_api_plateforme"("prefixe");

-- CreateIndex
CREATE INDEX "cles_api_plateforme_plateforme_id_idx" ON "cles_api_plateforme"("plateforme_id");

-- CreateIndex
CREATE INDEX "comptes_marchands_externes_marchand_id_idx" ON "comptes_marchands_externes"("marchand_id");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_marchands_externes_plateforme_id_id_externe_key" ON "comptes_marchands_externes"("plateforme_id", "id_externe");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_marchands_externes_plateforme_id_marchand_id_key" ON "comptes_marchands_externes"("plateforme_id", "marchand_id");

-- CreateIndex
CREATE INDEX "journal_appels_api_plateforme_id_horodatage_idx" ON "journal_appels_api"("plateforme_id", "horodatage");

-- CreateIndex
CREATE INDEX "journal_appels_api_reference_idx" ON "journal_appels_api"("reference");

-- AddForeignKey
ALTER TABLE "plateformes_partenaires" ADD CONSTRAINT "plateformes_partenaires_utilisateur_technique_id_fkey" FOREIGN KEY ("utilisateur_technique_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cles_api_plateforme" ADD CONSTRAINT "cles_api_plateforme_plateforme_id_fkey" FOREIGN KEY ("plateforme_id") REFERENCES "plateformes_partenaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comptes_marchands_externes" ADD CONSTRAINT "comptes_marchands_externes_plateforme_id_fkey" FOREIGN KEY ("plateforme_id") REFERENCES "plateformes_partenaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comptes_marchands_externes" ADD CONSTRAINT "comptes_marchands_externes_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_appels_api" ADD CONSTRAINT "journal_appels_api_plateforme_id_fkey" FOREIGN KEY ("plateforme_id") REFERENCES "plateformes_partenaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_appels_api" ADD CONSTRAINT "journal_appels_api_cle_id_fkey" FOREIGN KEY ("cle_id") REFERENCES "cles_api_plateforme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
