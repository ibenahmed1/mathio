-- Statuts des commandes d'inventaire : Brouillon, Commandée, Reçue, Annulée.
--
-- Écrite à la main, et non générée : pour un enum dont des valeurs changent,
-- Prisma recrée le type (nouveau type, conversion de la colonne, suppression
-- de l'ancien). RENAME VALUE garde chaque ligne existante sur la même valeur
-- interne — aucune réécriture, aucun risque de conversion ratée.
--
-- Correspondance des commandes existantes, décidée le 11/09/2026 :
--   en_attente → commandee  (passée au fournisseur, pas encore arrivée)
--   livre      → recue
ALTER TYPE "StatutCommandeStockHub" RENAME VALUE 'en_attente' TO 'commandee';
ALTER TYPE "StatutCommandeStockHub" RENAME VALUE 'livre' TO 'recue';

-- Avant `commandee`, pour que l'ordre de l'enum en base suive le cycle de vie.
-- Elle ne devient la valeur par défaut qu'à la migration suivante :
-- PostgreSQL refuse d'utiliser une valeur d'enum dans la transaction qui l'a
-- créée.
ALTER TYPE "StatutCommandeStockHub" ADD VALUE 'brouillon' BEFORE 'commandee';
