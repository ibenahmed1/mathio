-- Provenance d'un lien marchand : la synchronisation a-t-elle CRÉÉ ce
-- marchand, ou seulement rattaché un marchand qui existait déjà chez nous ?
--
-- Ne sert qu'à la PURGE des données de test (§ /admin/integrations), mais elle
-- y est décisive : on ne supprime que ce que la plateforme a créé. Un marchand
-- rattaché s'était inscrit en direct sur notre site — l'effacer avec les
-- données de test serait une perte irréversible.
--
-- Défaut `false`, y compris pour les lignes existantes : une provenance
-- inconnue n'est JAMAIS purgée. Le pire cas est donc qu'une donnée de test
-- survive à une purge, jamais qu'un vrai marchand disparaisse.

-- AlterTable
ALTER TABLE "comptes_marchands_externes" ADD COLUMN     "cree_par_synchro" BOOLEAN NOT NULL DEFAULT false;
