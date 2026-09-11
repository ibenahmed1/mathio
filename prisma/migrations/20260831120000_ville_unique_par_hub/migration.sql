-- Le nom d'une ville n'est plus unique pour TOUT le réseau, mais par HUB.
--
-- Motif (cf. le commentaire du modèle Ville dans prisma/schema.prisma) :
-- plusieurs prestataires desservent les mêmes villes — EST Livraison et Meta
-- Livraison annoncent tous deux Taza, Aknoul, Tahla, Bouhlou — chacun avec son
-- prix et son délai. Sous l'ancienne contrainte, le second réseau chargé se
-- voyait refuser ces villes : sa grille était amputée en silence et l'écran ne
-- reflétait plus sa couverture réelle.
--
-- Aucun doublon n'existe au moment de cette migration (les imports précédents
-- les écartaient), l'ajout de la contrainte ne peut donc pas échouer.

-- DropIndex
DROP INDEX "villes_nom_key";

-- CreateIndex : le nom reste indexé, il sert au rapprochement des villes
-- saisies en texte libre sur les colis (normaliserVille, lib/hub-stock.ts).
CREATE INDEX "villes_nom_idx" ON "villes"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "villes_hub_id_nom_key" ON "villes"("hub_id", "nom");
