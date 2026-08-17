-- Migration de "baseline" : ces objets existent déjà sur toutes les bases
-- réelles de ce projet (créés hors historique de migrations, probablement via
-- `prisma db push` pendant le développement initial de la réinitialisation de
-- mot de passe et du Kanban équipes) mais n'étaient tracés par aucun fichier
-- de migration. Ce fichier ne fait qu'enregistrer leur existence dans
-- l'historique — voir le commentaire dans schema.prisma pour le détail
-- fonctionnel de ces champs/table.

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "reset_token_expire" TIMESTAMP(3),
ADD COLUMN     "reset_token_hash" TEXT;

-- CreateTable
CREATE TABLE "equipes_taches_membres" (
    "id" TEXT NOT NULL,
    "equipe_id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipes_taches_membres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_reset_token_hash_key" ON "utilisateurs"("reset_token_hash");

-- CreateIndex
CREATE INDEX "equipes_taches_membres_equipe_id_idx" ON "equipes_taches_membres"("equipe_id");

-- CreateIndex
CREATE INDEX "equipes_taches_membres_utilisateur_id_idx" ON "equipes_taches_membres"("utilisateur_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipes_taches_membres_equipe_id_utilisateur_id_key" ON "equipes_taches_membres"("equipe_id", "utilisateur_id");

-- AddForeignKey
ALTER TABLE "equipes_taches_membres" ADD CONSTRAINT "equipes_taches_membres_equipe_id_fkey" FOREIGN KEY ("equipe_id") REFERENCES "equipes_taches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipes_taches_membres" ADD CONSTRAINT "equipes_taches_membres_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
