// § Fiche d'un bon d'envoi (16/10/2026) — ce que l'API du transporteur a fait
// de chaque colis, et donc ce qui reste à transmettre par l'Excel. Module PUR :
// lu par l'écran et par l'export « colis restants ».

export interface RemiseColis {
  etat: string;
  active: boolean;
  codeEnvoye: string;
  codeExterne: string | null;
  erreur: string | null;
}

// Parti chez le transporteur par son API — ou peut-être parti (à confirmer :
// leur API n'a pas répondu à temps, le colis existe peut-être chez eux). Dans
// les deux cas, il ne doit PAS repartir par l'Excel : il serait créé deux fois.
export function partiParApi(remises: readonly RemiseColis[] | undefined): boolean {
  return (remises ?? []).some((r) => r.active && (r.etat === 'acceptee' || r.etat === 'a_confirmer'));
}

export type EtatTransmissionApi =
  | { cle: 'api'; libelle: string; detail: string }
  | { cle: 'a_confirmer'; libelle: string; detail: string }
  | { cle: 'refuse'; libelle: string; detail: string }
  | { cle: 'excel'; libelle: string; detail: string };

// `remises` : celles de CE bon, la plus récente en tête.
export function etatTransmissionApi(remises: readonly RemiseColis[] | undefined): EtatTransmissionApi {
  const active = (remises ?? []).find((r) => r.active);
  if (active?.etat === 'acceptee') {
    return { cle: 'api', libelle: 'Envoyé par API', detail: active.codeExterne ?? active.codeEnvoye };
  }
  if (active?.etat === 'a_confirmer') {
    return { cle: 'a_confirmer', libelle: 'À confirmer', detail: 'Pas de réponse de leur API : vérifier par le suivi avant tout renvoi' };
  }
  const refus = (remises ?? []).find((r) => r.etat === 'refusee');
  if (refus) return { cle: 'refuse', libelle: 'À transmettre par Excel', detail: `Refusé par l’API${refus.erreur ? ` : ${refus.erreur}` : ''}` };
  return { cle: 'excel', libelle: 'À transmettre par Excel', detail: 'Non envoyé par API (ville non reconnue ou remise pas encore lancée)' };
}
