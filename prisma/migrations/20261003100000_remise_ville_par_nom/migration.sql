-- § Sous-traitance EST Livraison : leur API identifie les villes par un NOM, et
-- non par un entier. Une remise peut donc partir sans `city_id` ; le libellé
-- envoyé est figé dans `ville_envoyee`. Les remises existantes (Power,
-- Colivraison, Meta) gardent leur `city_id` et un `ville_envoyee` à NULL.

ALTER TABLE "remises_prestataire" ALTER COLUMN "city_id" DROP NOT NULL;
ALTER TABLE "remises_prestataire" ADD COLUMN "ville_envoyee" TEXT;
