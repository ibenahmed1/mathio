-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'agent_hub';

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "date_reception_hub" TIMESTAMP(3),
ADD COLUMN     "hub_reception_id" TEXT;

-- AlterTable
ALTER TABLE "historique_statuts_commande" ADD COLUMN     "hub_regional_id" TEXT,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "hub_regional_id" TEXT;

-- CreateIndex
CREATE INDEX "commandes_hub_reception_id_idx" ON "commandes"("hub_reception_id");

-- CreateIndex
CREATE INDEX "historique_statuts_commande_hub_regional_id_idx" ON "historique_statuts_commande"("hub_regional_id");

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_hub_regional_id_fkey" FOREIGN KEY ("hub_regional_id") REFERENCES "hubs_regionaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_hub_reception_id_fkey" FOREIGN KEY ("hub_reception_id") REFERENCES "hubs_regionaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historique_statuts_commande" ADD CONSTRAINT "historique_statuts_commande_hub_regional_id_fkey" FOREIGN KEY ("hub_regional_id") REFERENCES "hubs_regionaux"("id") ON DELETE SET NULL ON UPDATE CASCADE;
