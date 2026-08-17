-- AlterTable
ALTER TABLE "taches" ADD COLUMN     "bloque" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "raison_blocage" TEXT;

-- CreateTable
CREATE TABLE "historique_statuts_tache" (
    "id" TEXT NOT NULL,
    "tache_id" TEXT NOT NULL,
    "ancien_statut" "StatutTache",
    "nouveau_statut" "StatutTache" NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_statuts_tache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_jointes_tache" (
    "id" TEXT NOT NULL,
    "tache_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "auteur_id" TEXT NOT NULL,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pieces_jointes_tache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historique_statuts_tache_tache_id_idx" ON "historique_statuts_tache"("tache_id");

-- CreateIndex
CREATE INDEX "pieces_jointes_tache_tache_id_idx" ON "pieces_jointes_tache"("tache_id");

-- AddForeignKey
ALTER TABLE "historique_statuts_tache" ADD CONSTRAINT "historique_statuts_tache_tache_id_fkey" FOREIGN KEY ("tache_id") REFERENCES "taches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_statuts_tache" ADD CONSTRAINT "historique_statuts_tache_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_jointes_tache" ADD CONSTRAINT "pieces_jointes_tache_tache_id_fkey" FOREIGN KEY ("tache_id") REFERENCES "taches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_jointes_tache" ADD CONSTRAINT "pieces_jointes_tache_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

