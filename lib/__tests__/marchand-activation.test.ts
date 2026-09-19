import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAMPS_A_FINALISER,
  LABELS_CHAMP_PROFIL,
  champsProfilManquants,
  etatActivationMarchand,
  messageBlocage,
  type ProfilMarchandAFinaliser,
} from '../marchand-activation';

// § Inscription marchand progressive (lib/marchand-activation.ts).
//
// C'est la règle qui décide si un marchand peut produire des bons, demander un
// ramassage et voir ses factures. Elle est lue des deux côtés — l'API qui
// refuse et l'écran qui floute — donc une erreur ici ouvre silencieusement une
// fonctionnalité à un dossier vide, ou enferme un marchand en règle.
//
// Ce que ces tests ne couvrent pas : la pose effective du garde-fou dans
// chaque route (voir exigerMarchandOperationnel, lib/marchand-scope.ts) et le
// floutage côté client.

const PROFIL_COMPLET: ProfilMarchandAFinaliser = {
  telephone: '0612345678',
  cin: 'AB123456',
  ville: 'Casablanca',
  adresse: '12 rue des Lilas',
  rib: '123456789012345678901234',
  ribPhotoUrl: 'data:image/png;base64,xxx',
};

// Ce qu'un compte tout juste inscrit a réellement en base : seuls l'email, le
// mot de passe et le nom de boutique ont été demandés.
const PROFIL_A_LINSCRIPTION: ProfilMarchandAFinaliser = {
  telephone: null,
  cin: null,
  ville: null,
  adresse: null,
  rib: null,
  ribPhotoUrl: null,
};

test('un compte fraîchement inscrit doit finaliser tous les champs', () => {
  assert.deepEqual(champsProfilManquants(PROFIL_A_LINSCRIPTION), [...CHAMPS_A_FINALISER]);
});

test('chaque champ à finaliser porte un libellé affichable', () => {
  for (const champ of CHAMPS_A_FINALISER) {
    assert.ok(LABELS_CHAMP_PROFIL[champ], `libellé manquant pour ${champ}`);
  }
});

// Une espace saisie par mégarde dans un champ ne vaut pas une information :
// sans ce filtrage, un RIB " " déverrouillerait les bons de paiement.
test('un champ rempli d\'espaces reste manquant', () => {
  const manquants = champsProfilManquants({ ...PROFIL_COMPLET, rib: '   ' });
  assert.deepEqual(manquants, ['rib']);
});

test('profil incomplet : bloqué, quel que soit le statut administratif', () => {
  const etat = etatActivationMarchand({ profil: PROFIL_A_LINSCRIPTION, statut: 'actif' });
  assert.equal(etat.profilComplet, false);
  assert.equal(etat.operationnel, false);
  assert.equal(etat.blocage, 'profil_incomplet');
});

// Les deux verrous sont indépendants : compléter son dossier ne vaut pas
// approbation (choix produit — l'admin garde la main, RF-22).
test('profil complet mais non validé : bloqué en attente de validation', () => {
  const etat = etatActivationMarchand({ profil: PROFIL_COMPLET, statut: 'en_attente_validation' });
  assert.equal(etat.profilComplet, true);
  assert.equal(etat.operationnel, false);
  assert.equal(etat.blocage, 'validation_en_attente');
});

test('profil complet et compte validé : opérationnel', () => {
  const etat = etatActivationMarchand({ profil: PROFIL_COMPLET, statut: 'actif' });
  assert.equal(etat.operationnel, true);
  assert.equal(etat.blocage, null);
  assert.equal(messageBlocage(etat), '');
});

// La suspension passe devant tout le reste : orienter un marchand suspendu
// vers son formulaire de profil lui ferait remplir des champs pour rien.
test('un compte suspendu est bloqué avant toute autre raison', () => {
  const etat = etatActivationMarchand({ profil: PROFIL_A_LINSCRIPTION, statut: 'suspendu' });
  assert.equal(etat.blocage, 'compte_suspendu');
  assert.match(messageBlocage(etat), /suspendu/i);
});

// Le message est servi tel quel au marchand : il doit nommer ce qui manque,
// sinon le panneau flouté n'indique aucune action.
test('le message d\'un profil incomplet énumère les champs restants', () => {
  const etat = etatActivationMarchand({
    profil: { ...PROFIL_COMPLET, rib: null, ribPhotoUrl: null },
    statut: 'actif',
  });
  const message = messageBlocage(etat);
  assert.match(message, /RIB/);
  assert.match(message, /Justificatif RIB/);
  assert.doesNotMatch(message, /Ville/);
});

// Un compte suspendu dont le dossier est aussi incomplet ne doit pas recevoir
// une liste de champs à remplir : les remplir ne lèverait pas la suspension.
test('le message d\'un compte suspendu n\'énumère aucun champ', () => {
  const etat = etatActivationMarchand({ profil: PROFIL_A_LINSCRIPTION, statut: 'suspendu' });
  assert.doesNotMatch(messageBlocage(etat), /Champs à compléter/);
});
