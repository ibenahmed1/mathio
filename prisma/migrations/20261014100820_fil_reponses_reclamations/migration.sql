-- § Réclamations (14/10/2026) : fil des réponses — une réponse enregistrée reste,
-- elles se cumulent jusqu'à la fermeture.

-- CreateTable
CREATE TABLE "reponses_reclamations" (
    "id" TEXT NOT NULL,
    "reclamation_id" TEXT NOT NULL,
    "auteur_id" TEXT,
    "texte" TEXT NOT NULL,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reponses_reclamations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reponses_reclamations_reclamation_id_idx" ON "reponses_reclamations"("reclamation_id");

-- AddForeignKey
ALTER TABLE "reponses_reclamations" ADD CONSTRAINT "reponses_reclamations_reclamation_id_fkey" FOREIGN KEY ("reclamation_id") REFERENCES "reclamations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reponses_reclamations" ADD CONSTRAINT "reponses_reclamations_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de l'ancien champ unique : la dernière réponse donnée devient la
-- première du fil (auteur non conservé à l'époque).
INSERT INTO "reponses_reclamations" ("id", "reclamation_id", "auteur_id", "texte", "date_creation")
SELECT gen_random_uuid(), "id", NULL, "reponse", COALESCE("date_reponse", "date_creation")
FROM "reclamations"
WHERE "reponse" IS NOT NULL AND btrim("reponse") <> '';
