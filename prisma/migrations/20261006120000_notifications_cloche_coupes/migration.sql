-- § Notifications : chaque compte règle la cloche ET le push, type par type
-- (décision du 06/10/2026). Colonne vide par défaut : tout le monde continue
-- de tout recevoir dans sa cloche, rien à reprendre.

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "cloche_coupes" TEXT[] DEFAULT ARRAY[]::TEXT[];

