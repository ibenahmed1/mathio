-- § Notifications internes (NOTIFICATIONS.md) : cloche par compte, appareils
-- ayant accepté le push Firebase, et types de push coupés par le compte.
-- Aucune reprise de données : les tables naissent vides, et `push_coupes`
-- vide veut dire « tout ce que le catalogue pousse par défaut ».

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "push_coupes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "corps" TEXT,
    "lien" TEXT,
    "lue_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appareils_push" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "jeton" TEXT NOT NULL,
    "espace" TEXT NOT NULL,
    "navigateur" TEXT,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dernier_vu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appareils_push_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_utilisateur_id_cree_le_idx" ON "notifications"("utilisateur_id", "cree_le");

-- CreateIndex
CREATE INDEX "notifications_utilisateur_id_lue_le_idx" ON "notifications"("utilisateur_id", "lue_le");

-- CreateIndex
CREATE UNIQUE INDEX "appareils_push_jeton_key" ON "appareils_push"("jeton");

-- CreateIndex
CREATE INDEX "appareils_push_utilisateur_id_idx" ON "appareils_push"("utilisateur_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appareils_push" ADD CONSTRAINT "appareils_push_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

