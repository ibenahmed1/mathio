-- Le Planner reprend le circuit du colis stock (décision du 14/10/2026) et la
-- fonction `agent_stock`, ajoutée le même jour, disparaît.
--
--   1. Les comptes agent_stock deviennent des planners.
--   2. Le jeu par défaut du planner devient celui de l'agent stock
--      (§ ROLE_PERMISSIONS.planner, lib/permissions.ts) et REMPLACE l'ancien
--      (tournées de son hub) : les comptes planner y sont remis ; l'admin leur
--      coche ensuite tout accès supplémentaire au cas par cas.
--   3. Le rôle back-office prédéfini « Agent stock » est supprimé, ses membres
--      passent sur le Planner prédéfini.
--   4. PostgreSQL ne sait pas retirer une valeur d'enum : on recrée le type
--      sans elle (même procédé que 20260811120000_retire_role_agent_preparation).
BEGIN;

UPDATE "utilisateurs" SET "role" = 'planner' WHERE "role" = 'agent_stock';
UPDATE "utilisateurs" SET "roles_supplementaires" = array_remove("roles_supplementaires", 'agent_stock'::"Role")
WHERE 'agent_stock'::"Role" = ANY("roles_supplementaires");

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'stock:nouveaux',
  'stock:prets',
  'stock:inventory',
  'bon_envoi:create',
  'bon_envoi:manage',
  'colis:read',
  'colis:track',
  'bon_retour:manage'
] WHERE "role" = 'planner';

UPDATE "roles_backoffice" SET
  "permissions" = ARRAY[
    'stock:nouveaux',
    'stock:prets',
    'stock:inventory',
    'bon_envoi:create',
    'bon_envoi:manage',
    'colis:read',
    'colis:track',
    'bon_retour:manage'
  ],
  "description" = 'Mène le colis stock de sa validation à la livraison, au refus ou au retour.',
  "date_modification" = NOW()
WHERE "cle" = 'planner';

-- Sans Planner prédéfini en base (jamais visité), le lien tombe à NULL :
-- assurerRolesPredefinis le crée et le rattache à la première visite.
UPDATE "utilisateurs" SET "role_backoffice_id" = (SELECT "id" FROM "roles_backoffice" WHERE "cle" = 'planner')
WHERE "role_backoffice_id" IN (SELECT "id" FROM "roles_backoffice" WHERE "fonction" = 'agent_stock');
DELETE FROM "roles_backoffice" WHERE "fonction" = 'agent_stock';

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
  'agent_hub',
  'planner',
  'plateforme'
);

ALTER TABLE "utilisateurs" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" DROP DEFAULT;
ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" TYPE "Role_new"[] USING ("roles_supplementaires"::text[]::"Role_new"[]);
ALTER TABLE "utilisateurs" ALTER COLUMN "roles_supplementaires" SET DEFAULT ARRAY[]::"Role_new"[];
ALTER TABLE "roles_backoffice" ALTER COLUMN "fonction" TYPE "Role_new" USING ("fonction"::text::"Role_new");

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

COMMIT;
