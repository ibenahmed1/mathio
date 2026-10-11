-- § Journal de l'équipe (/admin/equipe?onglet=journal) : le détail d'une
-- action d'administration — changement de fonction, nom d'un compte supprimé.
-- Colonne facultative, vide pour les lignes existantes : ajout seul.

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "details" TEXT;
