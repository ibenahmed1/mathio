-- `environnement` entre dans les DEUX contraintes d'unicité de
-- `comptes_marchands_externes` (§ intégration Shipeh).
--
-- Ce n'est pas une précision cosmétique : c'est ce qui rend l'isolation bac à
-- sable / production STRUCTURELLE au lieu d'être tenue à la main.
--
-- Prisma dérive de ces contraintes les clés composées
-- `plateformeId_environnement_idExterne` et `..._marchandId`, et un
-- `findUnique` dessus EXIGE les trois champs : chercher un lien en oubliant
-- l'environnement ne compile plus.
--
-- Sans ça, la garantie reposait sur le fait qu'un développeur pense à comparer
-- les environnements après coup — et l'oubli s'était produit, sur la recherche
-- « déjà synchronisé » : une clé `live` y retrouvait le lien de TEST d'un même
-- idExterne, répondait « déjà synchronisé », puis le dépôt de colis échouait en
-- 404. La mise en production était silencieusement cassée pour tout marchand
-- ayant servi aux essais.
--
-- Migration SANS RISQUE et sans backfill : passer de unique(a,b) à
-- unique(a,b,c) est un RELÂCHEMENT — aucune ligne existante ne peut violer la
-- nouvelle contrainte.

-- DropIndex
DROP INDEX "comptes_marchands_externes_plateforme_id_id_externe_key";

-- DropIndex
DROP INDEX "comptes_marchands_externes_plateforme_id_marchand_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "comptes_marchands_externes_plateforme_id_environnement_id_e_key" ON "comptes_marchands_externes"("plateforme_id", "environnement", "id_externe");

-- CreateIndex
CREATE UNIQUE INDEX "comptes_marchands_externes_plateforme_id_environnement_marc_key" ON "comptes_marchands_externes"("plateforme_id", "environnement", "marchand_id");
