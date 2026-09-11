-- Rattache un compte machine (§ PlateformePartenaire) à un transporteur
-- sous-traitant (§ Prestataire), pour l'API de suivi que les prestataires
-- consomment : POST /api/v1/livraisons/statut.
--
-- POURQUOI CETTE COLONNE EXISTE
--
-- Sans elle, une clé d'API valide pourrait poser un statut sur N'IMPORTE quel
-- colis, puisque rien ne dirait de quel transporteur elle est la clé. C'est le
-- trou exact des API livreur du marché, où le corps de la requête ne porte
-- qu'un code de colis : deux transporteurs branchés, et le premier peut
-- clôturer les colis du second.
--
-- Le risque n'est pas théorique : `livre` est une écriture d'ARGENT. Elle ferme
-- le colis, le rend facturable au marchand et fait naître une dette COD du
-- transporteur. Le périmètre est donc la première garantie de cet endpoint,
-- avant l'authentification elle-même — une clé authentifiée mais sans
-- périmètre facture tout le monde.
--
-- CE QU'ELLE NE FAIT PAS
--
-- Elle ne PORTE pas le périmètre, elle le résout. Le périmètre reste dérivé du
-- référentiel existant : un colis appartient à ce transporteur quand son hub
-- actuel est l'une de ses agences (commandes.hub_actuel_id → hubs.prestataire_id),
-- ce qui est déjà la sémantique du modèle plat Hub↔Ville. Aucune table de
-- remise n'est créée, et `commandes` n'est pas touchée.
--
-- NULLABLE, et c'est le cas courant : les comptes existants sont des
-- plateformes de VENTE (Shipeh), qui déposent des colis et n'en livrent aucun.
-- La colonne reste vide pour eux, et la nature du compte se déduit du lien
-- plutôt que d'un enum `type` qui pourrait le contredire.
--
-- UNIQUE : un prestataire n'a qu'un compte machine. Deux comptes pour le même
-- transporteur signifieraient deux jeux de clés au même périmètre, donc deux
-- endroits à révoquer le jour d'une fuite — et un oublié.
ALTER TABLE "plateformes_partenaires" ADD COLUMN "prestataire_id" TEXT;

CREATE UNIQUE INDEX "plateformes_partenaires_prestataire_id_key"
  ON "plateformes_partenaires"("prestataire_id");

-- ON DELETE RESTRICT (défaut) : un prestataire porteur d'un compte machine ne
-- se supprime pas tant que ses clés existent. Le modèle ne supprime de toute
-- façon jamais un prestataire — il le désactive (`prestataires.actif`), pour
-- garder l'historique tarifaire des colis déjà livrés.
ALTER TABLE "plateformes_partenaires"
  ADD CONSTRAINT "plateformes_partenaires_prestataire_id_fkey"
  FOREIGN KEY ("prestataire_id") REFERENCES "prestataires"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
