-- Traçabilité de l'auteur des mouvements de stock (§ comments.md, point 3).
--
-- Jusqu'ici `historique_produits` ne portait qu'un texte libre : « 8, Chaussures
-- a été reçu ». En cas d'écart de comptage en entrepôt, impossible de savoir
-- quel agent avait validé la quantité — alors que la route exigeait déjà une
-- session admin, dont l'identité était simplement jetée.
--
-- Colonne NULLABLE, sans reprise de l'historique : les lignes antérieures n'ont
-- pas d'auteur connu, et les rattacher au compte d'amorçage fabriquerait une
-- preuve. Elles s'afficheront « — », ce qui est exact.
--
-- ON DELETE SET NULL : supprimer un compte utilisateur ne doit jamais effacer
-- l'historique de l'entrepôt.

ALTER TABLE "historique_produits"
  ADD COLUMN "utilisateur_id" TEXT;

ALTER TABLE "historique_produits"
  ADD CONSTRAINT "historique_produits_utilisateur_id_fkey"
  FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "historique_produits_utilisateur_id_idx"
  ON "historique_produits"("utilisateur_id");
