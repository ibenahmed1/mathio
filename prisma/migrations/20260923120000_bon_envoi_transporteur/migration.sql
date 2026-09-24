-- Un Bon d'Envoi vise désormais SOIT un de nos quais (transit interne, colonne
-- historique), SOIT un transporteur sous-traitant choisi à la main (§ BonEnvoi
-- dans prisma/schema.prisma pour les règles). Les bons déjà en base portent
-- tous un hub : ils satisfont la contrainte d'exclusivité sans reprise.

-- AlterTable
ALTER TABLE "bons_envoi" ALTER COLUMN "hub_destination_id" DROP NOT NULL;
ALTER TABLE "bons_envoi" ADD COLUMN "prestataire_id" TEXT;

-- CreateIndex
CREATE INDEX "bons_envoi_prestataire_id_idx" ON "bons_envoi"("prestataire_id");

-- AddForeignKey
ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_prestataire_id_fkey" FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exclusivité des deux destinations, posée À LA MAIN : Prisma ne sait pas
-- exprimer un CHECK inter-colonnes dans le schéma (même situation que l'index
-- partiel de remises_prestataire). Sans elle, un bon pourrait viser un quai ET
-- un transporteur, et plus rien ne dirait où part le colis.
ALTER TABLE "bons_envoi" ADD CONSTRAINT "bons_envoi_destination_exclusive" CHECK (("hub_destination_id" IS NOT NULL) <> ("prestataire_id" IS NOT NULL));
