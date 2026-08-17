-- Nouveau rôle cantonné à la préparation des colis de stock (Bons de
-- Préparation, § /admin/stock/bons-preparation) : ne peut traiter que les
-- colis enStock=true rattachés à un BonDePreparation. Confinement appliqué
-- côté application dans proxy.ts (ROLES_STOCK_PREPARATION_UNIQUEMENT,
-- lib/auth.ts), même principe que design/gestionnaire_hub (Kanban).
ALTER TYPE "Role" ADD VALUE 'agent_preparation';
