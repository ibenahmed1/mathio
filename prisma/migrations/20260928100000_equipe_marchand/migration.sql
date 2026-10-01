-- § Équipe & accès de l'espace marchand (/marchand/equipe) : rôles propres à
-- chaque boutique, rôle obligatoire sur chaque membre, invitations, accès
-- temporaire et journal d'équipe.
--
-- Reprise des données : avant cette migration, un membre invité avait accès à
-- toutes les données de sa boutique mais pas à la gestion de l'équipe. Chaque
-- boutique qui a déjà des membres reçoit donc le rôle prédéfini
-- « Gestionnaire » (ROLES_SYSTEME_MARCHAND, lib/permissions-marchand.ts), qui
-- reproduit exactement ce périmètre, et ses membres y sont rattachés : personne
-- ne gagne ni ne perd un accès le jour du déploiement. Les autres rôles
-- prédéfinis sont créés à la volée à la première ouverture de l'écran.

-- CreateEnum
CREATE TYPE "ModeAjoutMembre" AS ENUM ('manuel', 'invitation');

-- CreateTable
CREATE TABLE "roles_marchand" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "cle" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_modification" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_marchand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_equipe_marchand" (
    "id" TEXT NOT NULL,
    "marchand_id" TEXT NOT NULL,
    "auteur_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "cible" TEXT,
    "details" TEXT,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_equipe_marchand_pkey" PRIMARY KEY ("id")
);

-- AlterTable : `role_id` d'abord nullable, le temps de la reprise.
ALTER TABLE "marchand_membres" ADD COLUMN     "acces_expire_le" TIMESTAMP(3),
ADD COLUMN     "ajoute_par" TEXT,
ADD COLUMN     "invitation_acceptee_le" TIMESTAMP(3),
ADD COLUMN     "mode_ajout" "ModeAjoutMembre" NOT NULL DEFAULT 'manuel',
ADD COLUMN     "poste" TEXT,
ADD COLUMN     "role_id" TEXT;

-- Reprise : un rôle « Gestionnaire » par boutique ayant déjà des membres.
INSERT INTO "roles_marchand" ("id", "marchand_id", "nom", "description", "cle", "permissions", "date_modification")
SELECT gen_random_uuid()::text,
       m."marchand_id",
       'Gestionnaire',
       'Toute l’activité de la boutique, sans la gestion de l’équipe.',
       'gestionnaire',
       ARRAY['tableau_de_bord.voir','colis.voir','colis.creer','colis.modifier','colis.supprimer','colis.exporter',
             'catalogue.voir','catalogue.gerer','ramassages.voir','ramassages.demander','bons.voir','bons.creer',
             'factures.voir','reclamations.voir','reclamations.creer','integrations.gerer','boutique.gerer']::TEXT[],
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "marchand_id" FROM "marchand_membres") m;

UPDATE "marchand_membres" mm
SET "role_id" = r."id"
FROM "roles_marchand" r
WHERE r."marchand_id" = mm."marchand_id" AND r."cle" = 'gestionnaire';

ALTER TABLE "marchand_membres" ALTER COLUMN "role_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "roles_marchand_marchand_id_nom_key" ON "roles_marchand"("marchand_id", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "roles_marchand_marchand_id_cle_key" ON "roles_marchand"("marchand_id", "cle");

-- CreateIndex
CREATE INDEX "journal_equipe_marchand_marchand_id_horodatage_idx" ON "journal_equipe_marchand"("marchand_id", "horodatage");

-- CreateIndex
CREATE INDEX "marchand_membres_role_id_idx" ON "marchand_membres"("role_id");

-- AddForeignKey
ALTER TABLE "marchand_membres" ADD CONSTRAINT "marchand_membres_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles_marchand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marchand_membres" ADD CONSTRAINT "marchand_membres_ajoute_par_fkey" FOREIGN KEY ("ajoute_par") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_marchand" ADD CONSTRAINT "roles_marchand_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_equipe_marchand" ADD CONSTRAINT "journal_equipe_marchand_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_equipe_marchand" ADD CONSTRAINT "journal_equipe_marchand_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
