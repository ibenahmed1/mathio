-- § Code de ville communiqué aux partenaires : « V » + numéro sur trois
-- chiffres (V001, V002…, lib/ville-code.ts). La colonne porte le NUMÉRO ;
-- la base l'attribue à toute nouvelle ville (séquence), et il n'est jamais
-- réutilisé.

-- AlterTable : SERIAL remplit les lignes existantes au fil de la séquence.
ALTER TABLE "villes" ADD COLUMN "numero" SERIAL NOT NULL;

-- Numérotation de départ par ordre alphabétique du nom (puis du hub, puis de
-- l'identifiant, pour un ordre total et reproductible). Les villes des hubs
-- de test passent en dernier : elles n'ont pas à occuper les premiers codes.
-- Faite AVANT la pose de l'index unique : aucun conflit transitoire.
UPDATE "villes" v
SET "numero" = r.n
FROM (
  SELECT v2."id",
         ROW_NUMBER() OVER (
           ORDER BY (h."nom" LIKE 'Hub Audit Tournée%'), LOWER(v2."nom"), h."nom", v2."id"
         ) AS n
  FROM "villes" v2
  JOIN "hubs" h ON h."id" = v2."hub_id"
) r
WHERE r."id" = v."id";

-- La prochaine ville créée reçoit le numéro suivant le plus grand.
SELECT setval(
  pg_get_serial_sequence('"villes"', 'numero'),
  GREATEST((SELECT MAX("numero") FROM "villes"), 1),
  (SELECT COUNT(*) FROM "villes") > 0
);

-- CreateIndex
CREATE UNIQUE INDEX "villes_numero_key" ON "villes"("numero");
