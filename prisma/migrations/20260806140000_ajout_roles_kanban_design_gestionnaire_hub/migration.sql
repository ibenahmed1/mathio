-- Nouveaux rôles cantonnés à l'outil Kanban uniquement (§ /admin/tasks) :
-- aucun accès au reste du back-office (colis, finances, statistiques,
-- clients). Confinement appliqué côté application dans proxy.ts
-- (ROLES_KANBAN_UNIQUEMENT, lib/auth.ts).
ALTER TYPE "Role" ADD VALUE 'design';
ALTER TYPE "Role" ADD VALUE 'gestionnaire_hub';
