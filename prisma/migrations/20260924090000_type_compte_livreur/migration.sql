-- Un compte livreur est désormais typé : une personne (`individuel`) ou une
-- société de livraison qui travaille avec nous (`societe`). Cf.
-- TypeCompteLivreur dans prisma/schema.prisma pour ce que la distinction
-- change — et surtout pour ce qu'elle ne change pas : une société a
-- exactement les mêmes accès et les mêmes écrans qu'un individu.

-- CreateEnum
CREATE TYPE "TypeCompteLivreur" AS ENUM ('individuel', 'societe');

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN "type_livreur" "TypeCompteLivreur";
ALTER TABLE "utilisateurs" ADD COLUMN "raison_sociale" TEXT;
ALTER TABLE "utilisateurs" ADD COLUMN "ice" TEXT;

-- Reprise des comptes existants. Sans elle, tous les livreurs déjà en base
-- resteraient sans type — et « sans type » se lirait comme « pas encore
-- renseigné » alors qu'ils sont tous, à ce jour, des individus. La colonne
-- reste NULL pour les autres rôles : elle ne les concerne pas.
UPDATE "utilisateurs" SET "type_livreur" = 'individuel' WHERE "role" = 'livreur';
