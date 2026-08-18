-- Retrait du rôle agent_preparation (§ stock BPR) : la préparation des colis
-- de stock reste manuelle pour cette première version du système (le Bon de
-- Préparation suit désormais le même flux qu'un Bon de Livraison, cf.
-- POST /api/bons-preparation/[id]/bien-recu) — plus besoin d'un rôle dédié.
-- PostgreSQL ne permet pas de retirer une valeur d'un type enum directement
-- (pas de "ALTER TYPE ... DROP VALUE") : on recrée le type sans cette valeur
-- puis on bascule les colonnes qui l'utilisent. Aucune ligne n'utilise
-- 'agent_preparation' à ce jour (rôle jamais attribué), donc le cast direct
-- est sûr.
BEGIN;

CREATE TYPE "Role_new" AS ENUM (
  'admin',
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'marchand',
  'livreur',
  'ramasseur',
  'design',
  'gestionnaire_hub',
  'agent_hub'
);

ALTER TABLE "utilisateurs" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");

ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" DROP DEFAULT;
ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" TYPE "Role_new"[] USING ("roles_supplementaires"::text[]::"Role_new"[]);
ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" SET DEFAULT ARRAY[]::"Role_new"[];

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

COMMIT;
