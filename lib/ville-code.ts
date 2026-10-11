// § Code de ville communiqué aux partenaires (GET /v1/villes) : « V » suivi
// du numéro de la ville (Ville.numero) sur au moins trois chiffres — V001,
// V042, V500, puis V1000 au-delà de 999.
//
// Le numéro est attribué par la base et ne change jamais (cf. le schéma) : le
// code non plus. C'est le SEUL endroit qui fabrique ce code.
//
// Module PUR, sans import.
export function codeVille(numero: number): string {
  return `V${String(numero).padStart(3, '0')}`;
}
