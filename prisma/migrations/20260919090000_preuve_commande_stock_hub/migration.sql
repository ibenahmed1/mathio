-- Justificatif photo, facultatif, sur une commande d'inventaire de hub
-- (§ /admin/comptabilite, carte « Commandes d'inventaire »).
--
-- Pendant exact de transactions.preuve_url, ajoutée la veille
-- (20260918120000) : même convention de stockage (la photo entière encodée en
-- data URL, faute de stockage objet dans ce projet), même plafond applicatif de
-- 3 Mo décodés, même liste blanche de formats — lib/finance.ts les tient pour
-- les deux cartes de l'écran à la fois.
--
-- Nullable sans défaut : les commandes déjà saisies n'ont pas de justificatif,
-- et c'est un état normal, pas une donnée manquante à rattraper.

-- AlterTable
ALTER TABLE "commandes_stock_hub" ADD COLUMN     "preuve_url" TEXT;
