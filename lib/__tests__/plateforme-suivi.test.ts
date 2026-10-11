import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StatutCommande } from '../../app/generated/prisma/enums';
import { ErreurPlateforme } from '../plateforme-auth';
import {
  LIMITE_DEFAUT,
  LIMITE_MAX,
  analyserRequeteSuivi,
  decoderCurseur,
  encoderCurseur,
} from '../plateforme-suivi';
import { LABELS_STATUT_COMMANDE, STATUTS_COMMANDE, STATUTS_TERMINAUX } from '../statuts';

function codeRefus(params: string): string | null {
  try {
    analyserRequeteSuivi(new URLSearchParams(params));
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

test('chaque statut a un libellé : c’est ce qui sort tel quel vers la plateforme', () => {
  for (const statut of Object.values(StatutCommande)) {
    assert.ok(LABELS_STATUT_COMMANDE[statut], `${statut} sans libellé`);
    assert.ok(STATUTS_COMMANDE.includes(statut), `${statut} absent de la liste documentée`);
  }
  // Les statuts finaux, sur lesquels une plateforme paie ou clôt.
  assert.deepEqual([...STATUTS_TERMINAUX].sort(), ['annule', 'annule_par_vendeur', 'livre', 'retourne']);
});

test('modifiesDepuis est requis sans curseur, et doit être une date ISO', () => {
  assert.equal(codeRefus(''), 'champ_requis');
  assert.equal(codeRefus('modifiesDepuis=hier'), 'date_invalide');
  assert.equal(codeRefus('modifiesDepuis=10/10/2026'), 'date_invalide');
  const r = analyserRequeteSuivi(new URLSearchParams('modifiesDepuis=2026-10-10T08:00:00Z'));
  assert.equal(r.depuis?.toISOString(), '2026-10-10T08:00:00.000Z');
  assert.equal(r.limite, LIMITE_DEFAUT);
});

test('la limite est bornée', () => {
  assert.equal(codeRefus('modifiesDepuis=2026-10-10T08:00:00Z&limite=0'), 'limite_invalide');
  assert.equal(codeRefus(`modifiesDepuis=2026-10-10T08:00:00Z&limite=${LIMITE_MAX + 1}`), 'limite_invalide');
  assert.equal(codeRefus('modifiesDepuis=2026-10-10T08:00:00Z&limite=2.5'), 'limite_invalide');
  assert.equal(analyserRequeteSuivi(new URLSearchParams(`modifiesDepuis=2026-10-10T08:00:00Z&limite=${LIMITE_MAX}`)).limite, LIMITE_MAX);
});

test('le curseur fait l’aller-retour, et remplace modifiesDepuis', () => {
  const date = new Date('2026-10-10T14:22:11.123Z');
  const curseur = encoderCurseur(date, 'abc-123');
  assert.deepEqual(decoderCurseur(curseur), { horodatage: date, id: 'abc-123' });
  const r = analyserRequeteSuivi(new URLSearchParams(`curseur=${curseur}`));
  assert.equal(r.depuis, null);
  assert.equal(r.curseur?.id, 'abc-123');
});

test('un curseur illisible est refusé en 400, pas en 500', () => {
  assert.equal(codeRefus('curseur=nimporte-quoi'), 'curseur_invalide');
});
