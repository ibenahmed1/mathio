-- Compte HUMAIN d'un transporteur sous-traitant : un compte livreur de type
-- `societe` avec lequel il ouvre une session, voit les colis qu'on lui a
-- confiés par bon d'envoi et en déclare l'issue. Pendant de son compte
-- machine (§ PlateformePartenaire.prestataireId), pour les transporteurs qui
-- n'ont pas de système à brancher.
--
-- Optionnel, et sans reprise : aucun rattachement n'existe aujourd'hui, et un
-- transporteur sans compte se comporte exactement comme avant. Le
-- rattachement n'est pas rétroactif non plus — les colis des bons d'envoi
-- déjà créés gardent leur `livreur_id` d'origine (le plus souvent NULL).

-- AlterTable
ALTER TABLE "prestataires" ADD COLUMN "compte_livreur_id" TEXT;

-- CreateIndex
-- UNIQUE : un compte ne peut être le compte que d'un seul transporteur. Sans
-- cette contrainte, deux transporteurs partageraient une feuille de route et
-- chacun verrait les colis de l'autre.
CREATE UNIQUE INDEX "prestataires_compte_livreur_id_key" ON "prestataires"("compte_livreur_id");

-- AddForeignKey
ALTER TABLE "prestataires" ADD CONSTRAINT "prestataires_compte_livreur_id_fkey" FOREIGN KEY ("compte_livreur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
