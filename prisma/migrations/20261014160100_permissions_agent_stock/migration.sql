-- Jeu par défaut de la fonction `agent_stock` (§ lib/permissions.ts) : les
-- écrans du circuit du colis stock, rien d'autre. Migration à part de l'ajout
-- de la valeur d'enum : Postgres refuse d'utiliser une valeur ajoutée dans la
-- même transaction.

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'stock:nouveaux',
  'stock:prets',
  'stock:inventory',
  'bon_envoi:create',
  'bon_envoi:manage',
  'colis:read',
  'colis:track',
  'bon_retour:manage'
] WHERE "role" = 'agent_stock';
