import { LABELS_STATUT_COMMANDE, LABELS_STATUT_RECLAMATION } from '@/lib/statuts';

const STYLES: Record<string, string> = {
  // Statuts marchand / ramassage (enums séparés, valeurs distinctes de StatutCommande)
  en_attente_validation: 'bg-black/10 text-black dark:bg-white/10 dark:text-white',
  en_attente: 'bg-black/10 text-black dark:bg-white/10 dark:text-white',
  effectuee: 'bg-green-600 text-white',
  actif: 'bg-green-600 text-white',
  suspendu: 'bg-orange-500 text-white',

  // Nouveau / en attente (gris)
  nouveau_colis: 'bg-black/10 text-black dark:bg-white/10 dark:text-white',
  attente_de_ramassage: 'bg-black/20 text-black dark:bg-white/20 dark:text-white',
  en_cours: 'bg-black/20 text-black dark:bg-white/20 dark:text-white',

  // Relance / call-center (ambre)
  boite_vocale: 'bg-amber-200 text-amber-950',
  deuxieme_appel_pas_reponse: 'bg-amber-300 text-amber-950',
  troisieme_appel_pas_reponse: 'bg-amber-400 text-amber-950',
  pas_de_reponse_sms: 'bg-amber-300 text-amber-950',
  injoignable: 'bg-orange-400 text-black',
  numero_errone: 'bg-amber-500 text-black',
  client_interesse: 'bg-yellow-300 text-yellow-950',
  relance_nouveau_client: 'bg-yellow-300 text-yellow-950',
  attente_de_relancer: 'bg-yellow-200 text-yellow-950',
  programme: 'bg-sky-200 text-sky-900',
  reporte: 'bg-amber-200 text-amber-950',

  // Logistique (bleu)
  ramasse: 'bg-[#eae8ff] text-[#4c46b3]',
  recu: 'bg-sky-300 text-sky-950',
  // § Gestion de stock (pipeline propre aux colis enStock, cf. lib/hub-stock.ts)
  pret_pour_preparation: 'bg-indigo-300 text-indigo-950',
  recu_au_hub: 'bg-[#ffebe7] text-[#b5502e]',
  en_transit: 'bg-[#ccfbfe] text-[#0f7a8c]',
  expedie: 'bg-black text-white dark:bg-white dark:text-black',
  expedier_par_amana: 'bg-sky-500 text-white',
  en_voyage: 'bg-sky-400 text-sky-950',
  mise_en_distribution: 'bg-blue-600 text-white',

  // Succès (vert)
  livre: 'bg-green-600 text-white',

  // Échec / retour (rouge-orange)
  hors_zone: 'bg-orange-500 text-white',
  refuse: 'bg-red-500 text-white',
  retourne: 'bg-orange-500 text-white',
  en_retour_par_amana: 'bg-orange-600 text-white',
  annule: 'bg-red-600 text-white',
  annule_par_vendeur: 'bg-red-700 text-white',

  // État de paiement
  rembourse: 'bg-purple-500 text-white',

  // Réclamations
  ouverte: 'bg-orange-500 text-white',
  resolue: 'bg-green-600 text-white',
  rejetee: 'bg-red-600 text-white',
};

// § /admin/scan/reception : le hub de réception est celui de l'agent qui a
// scanné le colis (résolu côté serveur, cf. resolveUserHub) — hubVille vient
// donc de commande.hubActuel.ville, jamais saisi manuellement.
export function StatutBadge({ statut, hubVille }: { statut: string; hubVille?: string | null }) {
  const baseLabel =
    LABELS_STATUT_COMMANDE[statut as keyof typeof LABELS_STATUT_COMMANDE] ??
    LABELS_STATUT_RECLAMATION[statut as keyof typeof LABELS_STATUT_RECLAMATION] ??
    statut.replace(/_/g, ' ');
  const label = statut === 'recu_au_hub' && hubVille ? `${baseLabel} (${hubVille})` : baseLabel;
  return (
    <span className={`badge ${STYLES[statut] ?? 'bg-black/10 text-black dark:bg-white/10 dark:text-white'}`}>
      {label}
    </span>
  );
}
