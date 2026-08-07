-- CreateEnum
CREATE TYPE "StatutTache" AS ENUM ('a_faire', 'en_cours', 'termine');

-- CreateEnum
CREATE TYPE "PrioriteTache" AS ENUM ('faible', 'moyenne', 'elevee');

-- CreateTable
CREATE TABLE "equipes_taches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "couleur" TEXT NOT NULL DEFAULT 'gray',

    CONSTRAINT "equipes_taches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taches" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "statut" "StatutTache" NOT NULL DEFAULT 'a_faire',
    "priorite" "PrioriteTache" NOT NULL DEFAULT 'moyenne',
    "team_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "createur_id" TEXT NOT NULL,
    "date_echeance" DATE,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commentaires_tache" (
    "id" TEXT NOT NULL,
    "tache_id" TEXT NOT NULL,
    "auteur_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "mention_ids" TEXT[],
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commentaires_tache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipes_taches_code_key" ON "equipes_taches"("code");

-- CreateIndex
CREATE INDEX "taches_team_id_idx" ON "taches"("team_id");

-- CreateIndex
CREATE INDEX "taches_assignee_id_idx" ON "taches"("assignee_id");

-- CreateIndex
CREATE INDEX "taches_statut_idx" ON "taches"("statut");

-- CreateIndex
CREATE INDEX "commentaires_tache_tache_id_idx" ON "commentaires_tache"("tache_id");

-- AddForeignKey
ALTER TABLE "taches" ADD CONSTRAINT "taches_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "equipes_taches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taches" ADD CONSTRAINT "taches_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taches" ADD CONSTRAINT "taches_createur_id_fkey" FOREIGN KEY ("createur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commentaires_tache" ADD CONSTRAINT "commentaires_tache_tache_id_fkey" FOREIGN KEY ("tache_id") REFERENCES "taches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commentaires_tache" ADD CONSTRAINT "commentaires_tache_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

