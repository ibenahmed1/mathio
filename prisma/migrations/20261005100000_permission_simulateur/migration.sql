-- `simulateur:use` (§ lib/permissions.ts) : le simulateur de rentabilité
-- (/admin/simulateur), un outil de calcul qui ne lit ni n'écrit aucune donnée
-- de la plateforme.
--
-- Accordée au seul rôle `admin` par défaut ; les autres rôles la reçoivent au
-- cas par cas depuis Équipe & rôles. On CONCATÈNE (`||`) pour ne pas écraser
-- les ajustements faits à la main — même convention que
-- 20260902103100_permission_integrations.
--
-- L'admin détient de toute façon le catalogue entier à l'exécution
-- (effectivePermissions) : ce remplissage remet seulement la colonne stockée
-- d'accord avec le code.

UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'simulateur:use'
] WHERE "role" = 'admin';
