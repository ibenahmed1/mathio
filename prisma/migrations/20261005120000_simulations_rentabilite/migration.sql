-- § Simulateur de rentabilité : scénarios enregistrés, pour les rouvrir et
-- comparer plusieurs produits côte à côte. Seule la SAISIE est stockée ; les
-- résultats sont recalculés à la lecture (cf. schema.prisma).

CREATE TABLE "simulations_rentabilite" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "entrees" JSONB NOT NULL,
    "taux" JSONB NOT NULL,
    "marchand_id" TEXT,
    "auteur_id" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_modification" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulations_rentabilite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "simulations_rentabilite_marchand_id_date_modification_idx" ON "simulations_rentabilite"("marchand_id", "date_modification");

ALTER TABLE "simulations_rentabilite" ADD CONSTRAINT "simulations_rentabilite_marchand_id_fkey" FOREIGN KEY ("marchand_id") REFERENCES "marchands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "simulations_rentabilite" ADD CONSTRAINT "simulations_rentabilite_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
