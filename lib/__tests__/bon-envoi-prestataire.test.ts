import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUTS_RECUS_ENVOI, statutsEligiblesPrestataire } from '../bon-envoi-prestataire';
import { STATUTS_COMMANDE, STATUTS_TERMINAUX } from '../statuts';
import { CORRESPONDANCES_VILLES_POWER, resoudreVilleToutesAgencesPower } from '../power-delivery-villes';

// § Mode « Remise à un transporteur » : la liste proposée par défaut. Le colis
// à peine créé en fait partie — un prestataire qui ramasse lui-même n'attend
// pas qu'il soit passé par un de nos quais.
test('les statuts par défaut couvrent le colis neuf comme le colis reçu', () => {
  assert.ok(STATUTS_RECUS_ENVOI.includes('nouveau_colis'));
  assert.ok(STATUTS_RECUS_ENVOI.includes('recu'));
  assert.ok(STATUTS_RECUS_ENVOI.includes('recu_au_hub'));
  assert.deepEqual(statutsEligiblesPrestataire(false), STATUTS_RECUS_ENVOI);
});

// La seule restriction de statut qui subsiste en mode large. Elle n'est pas
// une commodité d'écran : expédier un colis déjà livré corromprait son
// historique.
test('le mode large garde tout sauf les statuts terminaux', () => {
  const larges = statutsEligiblesPrestataire(true);

  for (const terminal of STATUTS_TERMINAUX) {
    assert.ok(!larges.includes(terminal), `${terminal} ne doit jamais être expédiable`);
  }
  assert.equal(larges.length, STATUTS_COMMANDE.length - STATUTS_TERMINAUX.length);
});

test('le mode large est un sur-ensemble du mode par défaut', () => {
  const larges = statutsEligiblesPrestataire(true);
  for (const statut of STATUTS_RECUS_ENVOI) {
    assert.ok(larges.includes(statut), `${statut} disparaît en mode large`);
  }
});

// § Bon d'envoi adressé directement à Power Delivery : sans agence de départ,
// une ville n'est résolue que si elle ne prête à aucune hésitation. Les cas
// sont dérivés du référentiel plutôt que cités en dur — une ville nommée dans
// le test vieillirait dès la prochaine mise à jour de leur couverture.
function cityIdsParVille(): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const c of CORRESPONDANCES_VILLES_POWER) {
    const cle = c.ville.trim().toLowerCase();
    index.set(cle, (index.get(cle) ?? new Set<number>()).add(c.cityId));
  }
  return index;
}

test('une ville sans ambiguïté se résout sans agence de départ', () => {
  const index = cityIdsParVille();
  const sansAmbiguite = CORRESPONDANCES_VILLES_POWER.find(
    (c) => index.get(c.ville.trim().toLowerCase())?.size === 1
  );

  assert.ok(sansAmbiguite, 'le référentiel Power doit contenir au moins une ville non ambiguë');
  assert.equal(resoudreVilleToutesAgencesPower(sansAmbiguite.ville)?.cityId, sansAmbiguite.cityId);
});

// Le cœur de la garantie : deux dépôts qui revendiquent la même ville avec des
// identifiants différents ne doivent JAMAIS être départagés en silence.
test('une ville revendiquée par deux dépôts reste sans correspondance', () => {
  const index = cityIdsParVille();
  for (const [ville, cityIds] of index) {
    if (cityIds.size > 1) {
      assert.equal(resoudreVilleToutesAgencesPower(ville), null, `${ville} a été tranchée arbitrairement`);
    }
  }
});

test('une ville inconnue de Power reste sans correspondance', () => {
  assert.equal(resoudreVilleToutesAgencesPower('Ville Qui N Existe Pas'), null);
});
