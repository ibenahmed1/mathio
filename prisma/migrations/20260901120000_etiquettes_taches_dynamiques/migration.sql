-- Étiquettes de tâche tenues en base (§ /admin/tasks) : la liste était figée
-- dans le code (lib/statuts.ts), en ajouter une demandait un déploiement.
CREATE TABLE "etiquettes_taches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "couleur" TEXT NOT NULL DEFAULT 'docs',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etiquettes_taches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etiquettes_taches_code_key" ON "etiquettes_taches"("code");

-- Reprise des six étiquettes historiques : les tâches existantes portent déjà
-- ces codes dans "taches"."etiquettes", elles resteraient sans libellé ni
-- couleur si la table démarrait vide.
INSERT INTO "etiquettes_taches" ("id", "code", "nom", "couleur") VALUES
  (gen_random_uuid(), 'design',   'Design',   'design'),
  (gen_random_uuid(), 'frontend', 'Frontend', 'frontend'),
  (gen_random_uuid(), 'backend',  'Backend',  'backend'),
  (gen_random_uuid(), 'research', 'Research', 'research'),
  (gen_random_uuid(), 'bug',      'Bug',      'bug'),
  (gen_random_uuid(), 'docs',     'Docs',     'docs');
