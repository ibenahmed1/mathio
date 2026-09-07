-- `integrations:manage` (§ lib/permissions.ts) : administration des
-- plateformes partenaires — émission et révocation des clés d'API, marchands
-- synchronisés, journal des appels reçus.
--
-- Accordée au seul rôle `admin`, et c'est délibéré : une clé d'API donne à une
-- machine tierce le droit de créer des marchands DÉJÀ VALIDÉS (elle
-- court-circuite RF-22) et de déposer des colis. La rattacher à
-- `settings:manage`, que tout le back-office détient, aurait été l'exact
-- « élargissement silencieux » que la règle n°2 de lib/permission-routes.ts
-- interdit.
--
-- On CONCATÈNE (`||`) plutôt que de réaffecter, pour ne pas écraser les
-- ajustements faits à la main depuis l'écran de gestion des utilisateurs —
-- même convention que 20260828140000_permissions_complements.
--
-- L'admin détient de toute façon le catalogue entier à l'exécution
-- (effectivePermissions, lib/permissions.ts) : ce remplissage n'ouvre donc
-- rien de nouveau, il remet la colonne stockée d'accord avec le code. C'est ce
-- que vérifie le test « le remplissage SQL des migrations correspond à
-- ROLE_PERMISSIONS », et c'est lui qui a rendu cet oubli visible.

UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'integrations:manage'
] WHERE "role" = 'admin';
