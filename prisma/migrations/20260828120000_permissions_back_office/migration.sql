-- Permissions fines du back-office (§ lib/permissions.ts).
--
-- Le remplissage ci-dessous reproduit EXACTEMENT ce que chaque rôle voyait
-- avant cette migration (navigation de components/admin/nav.ts + gardes
-- `requireUser` des routes) : aucun compte existant ne gagne ni ne perd un
-- accès au moment du déploiement. Ce sont les valeurs de ROLE_PERMISSIONS,
-- recopiées ici — les deux doivent rester d'accord si l'une évolue.

ALTER TABLE "utilisateurs" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- admin : catalogue complet. Rempli pour que l'écran de gestion affiche
-- l'état réel, même si effectivePermissions() le lui accorde de toute façon.
UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:create','colis:import','colis:read','colis:track','colis:confirm',
  'stats:all','stats:client','stats:livreur','stats:zone','stats:ville','stats:compare',
  'stock:nouveaux','stock:prets','stock:bons_preparation','stock:inventory',
  'bon_livraison:manage','bon_envoi:manage','planification:manage','bon_distribution:manage','scan:tournee','scan:reception_hub',
  'paiement_livreur:manage','paiement_zone:manage',
  'bon_retour:manage',
  'facture:create','facture:read','comptabilite:read',
  'reclamations:manage','marchands:manage','demande_ramassage:manage',
  'users:manage','tasks:manage','hubs:manage','settings:manage'
] WHERE "role" = 'admin';

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:import','colis:read','colis:track','colis:confirm',
  'stats:all','stats:client','stats:livreur','stats:zone','stats:ville','stats:compare',
  'reclamations:manage',
  'tasks:manage','settings:manage'
] WHERE "role" = 'superviseur';

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:import','colis:read','colis:track',
  'stats:all','stats:client','stats:livreur','stats:zone','stats:ville','stats:compare',
  'paiement_livreur:manage','paiement_zone:manage',
  'facture:create','facture:read','comptabilite:read',
  'tasks:manage','settings:manage'
] WHERE "role" = 'responsable';

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:read','colis:track','colis:confirm',
  'reclamations:manage',
  'tasks:manage','settings:manage'
] WHERE "role" = 'moderateur';

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:read','colis:track','colis:confirm',
  'tasks:manage','settings:manage'
] WHERE "role" = 'equipe_suivi';

UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'dashboard:view',
  'colis:read','colis:track',
  'planification:manage','bon_distribution:manage','scan:tournee',
  'bon_retour:manage',
  'tasks:manage','settings:manage'
] WHERE "role" = 'planner';

-- agent_hub : son écran de réception liste les colis reçus du jour
-- (GET /api/commandes), d'où `colis:read`. Le confinement de chemin
-- (ROLES_HUB_UNIQUEMENT, proxy.ts) lui ferme /admin/commandes malgré tout.
UPDATE "utilisateurs" SET "permissions" = ARRAY[
  'scan:reception_hub','bon_envoi:manage','colis:read'
] WHERE "role" = 'agent_hub';

UPDATE "utilisateurs" SET "permissions" = ARRAY['tasks:manage']
WHERE "role" IN ('design', 'gestionnaire_hub');

-- marchand / livreur / ramasseur : hors catalogue (leur accès est gouverné par
-- le rôle et le domaine, cf. lib/permissions.ts). Liste vide, valeur par défaut.
