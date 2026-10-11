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
import { STATUTS_PUBLICS, STATUT_INTERNE_VERS_PUBLIC } from '../statut-public';

function codeRefus(params: string): string | null {
  try {
    analyserRequeteSuivi(new URLSearchParams(params));
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

test('chaque statut interne a une projection publique, dans le vocabulaire fermé', () => {
  for (const interne of Object.values(StatutCommande)) {
    const p = STATUT_INTERNE_VERS_PUBLIC[interne];
    assert.ok(p, `${interne} sans projection`);
    assert.ok((STATUTS_PUBLICS as readonly string[]).includes(p.statut), `${interne} → ${p.statut}`);
  }
  // Les états qui comptent pour le paiement d'un vendeur.
  assert.deepEqual(STATUT_INTERNE_VERS_PUBLIC.livre, { statut: 'delivered', motif: null });
  assert.deepEqual(STATUT_INTERNE_VERS_PUBLIC.retourne, { statut: 'returned', motif: null });
  assert.equal(STATUT_INTERNE_VERS_PUBLIC.refuse.motif, 'refused_by_recipient');
});

test('le rang d’un appel n’est jamais exposé', () => {
  assert.deepEqual(STATUT_INTERNE_VERS_PUBLIC.deuxieme_appel_pas_reponse, STATUT_INTERNE_VERS_PUBLIC.troisieme_appel_pas_reponse);
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
