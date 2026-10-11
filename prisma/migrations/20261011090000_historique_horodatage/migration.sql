-- § GET /v1/colis (suivi des colis par les plateformes) : les événements de
-- statut sont lus dans l'ordre (horodatage, id). Index seul, aucune donnée
-- modifiée.

-- CreateIndex
CREATE INDEX "historique_statuts_commande_horodatage_id_idx" ON "historique_statuts_commande"("horodatage", "id");
