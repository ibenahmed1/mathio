-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "roles_supplementaires" "Role"[] DEFAULT ARRAY[]::"Role"[];
