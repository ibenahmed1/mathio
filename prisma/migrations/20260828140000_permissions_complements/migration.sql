-- Clés ajoutées au catalogue après la première mise en service des permissions
-- (§ lib/permissions.ts) : elles comblent les endroits où une seule clé
-- recouvrait deux droits de portée différente.
--
--   colis:update / colis:delete   modifier et supprimer un colis, que
--                                 `colis:create` ne décrivait pas
--   colis:payment                 encaissement COD sur un colis
--   bon_envoi:create              composer un bon d'envoi, distinct de le
--                                 consulter et de le réceptionner
--   facture:issue                 émettre / encaisser / annuler une facture
--   comptabilite:write            saisir ou annuler une écriture
--   marchands:impersonate         accès support au compte d'un marchand
--   poles:manage / poles:members  cycle de vie d'un pôle vs affectation de ses
--                                 membres
--   villes:manage / societe:manage  ce qui s'ÉCRIT dans les paramètres, que
--                                 `settings:manage` (ouvrir l'écran) ne
--                                 gouvernait pas
--
-- Chaque clé est accordée EXACTEMENT aux rôles qui exerçaient déjà le droit
-- correspondant via leur `requireUser([...])` : personne ne gagne ni ne perd
-- un accès. On CONCATÈNE (`||`) au lieu de réaffecter, pour ne pas écraser les
-- ajustements faits à la main depuis l'écran de gestion des utilisateurs.

UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'colis:update','colis:delete','colis:payment',
  'bon_envoi:create',
  'facture:issue','comptabilite:write',
  'marchands:impersonate',
  'poles:manage','poles:members',
  'villes:manage','societe:manage'
] WHERE "role" = 'admin';

-- PATCH /api/commandes/<id>/paiement : admin + superviseur + responsable.
-- GET /api/taches/equipes et les membres : ROLES_GESTION_EQUIPES, qui couvre
-- tout le back-office sauf planner et agent_hub, plus design/gestionnaire_hub.
UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'colis:payment','poles:members'
] WHERE "role" = 'superviseur';

UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY[
  'colis:payment','facture:issue','comptabilite:write','poles:members'
] WHERE "role" = 'responsable';

UPDATE "utilisateurs" SET "permissions" = "permissions" || ARRAY['poles:members']
WHERE "role" IN ('moderateur', 'equipe_suivi', 'design', 'gestionnaire_hub');

-- planner et agent_hub : aucune des nouvelles clés. Le planner n'est pas dans
-- ROLES_GESTION_EQUIPES, et l'agent de quai réceptionne les bons d'envoi sans
-- jamais en composer — c'est précisément ce que la scission
-- bon_envoi:manage / bon_envoi:create permet enfin d'exprimer.
