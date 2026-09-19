-- Justificatif photo, facultatif, sur une écriture comptable (§ /admin/comptabilite).
--
-- La colonne porte la photo ENTIÈRE, encodée en data URL
-- (« data:image/jpeg;base64,… ») : ce projet n'a pas de stockage objet, et
-- toutes les images y suivent déjà cette convention (photos de compte, CIN,
-- signatures et preuves de livraison, logo). Voir prisma/schema.prisma pour la
-- règle complète et lib/finance.ts pour le plafond et les formats acceptés.
--
-- TEXT et non VARCHAR(n) : le contenu est de taille libre, seule la validation
-- applicative le borne (3 Mo décodés). Au-delà de quelques kilo-octets
-- PostgreSQL sort la valeur de la ligne (TOAST, compressée), de sorte que le
-- journal comptable reste aussi rapide à lire qu'avant — à condition que les
-- requêtes de liste ne demandent pas la colonne.
--
-- Nullable sans défaut : les écritures déjà saisies n'ont pas de justificatif,
-- et c'est un état normal, pas une donnée manquante à rattraper.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "preuve_url" TEXT;
