// Formes légères correspondant aux réponses JSON de l'API (Decimal/Date sérialisés en string).

export interface Commande {
  id: string;
  codeSuivi: string;
  marchandId: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  adresse: string;
  produitDescription: string | null;
  marchandiseId: string | null;
  produitId: string | null;
  quantite: number;
  notes: string | null;
  colisARemplacerId: string | null;
  ouvrir: boolean;
  fragile: boolean;
  aRemplacer: boolean;
  enStock: boolean;
  montantCod: string;
  poidsKg: string | null;
  statut:
    | 'nouveau_colis'
    | 'attente_de_ramassage'
    | 'ramasse'
    | 'recu'
    | 'pret_pour_preparation'
    | 'recu_au_hub'
    | 'en_transit'
    | 'expedie'
    | 'expedier_par_amana'
    | 'en_voyage'
    | 'mise_en_distribution'
    | 'livre'
    | 'en_cours'
    | 'boite_vocale'
    | 'deuxieme_appel_pas_reponse'
    | 'troisieme_appel_pas_reponse'
    | 'pas_de_reponse_sms'
    | 'injoignable'
    | 'numero_errone'
    | 'client_interesse'
    | 'relance_nouveau_client'
    | 'attente_de_relancer'
    | 'programme'
    | 'reporte'
    | 'hors_zone'
    | 'refuse'
    | 'retourne'
    | 'retourne_au_hub'
    | 'en_retour_par_amana'
    | 'annule'
    | 'annule_par_vendeur';
  etatPaiement: 'non_paye' | 'facture' | 'paye' | 'rembourse';
  aRisque: boolean;
  ramassageId: string | null;
  bonLivraisonId: string | null;
  bonPreparationId: string | null;
  bonEnvoiId: string | null;
  bonDistributionId: string | null;
  villeId: string | null;
  ramasseurId: string | null;
  livreurId: string | null;
  cinUrl: string | null;
  motifRetour: string | null;
  photoPreuveUrl: string | null;
  signatureUrl: string | null;
  dateCreation: string;
  dateCollecte: string | null;
  dateLivraison: string | null;
  // § /livreur/colis, action "Reporté" : date de nouvelle tentative choisie
  // par le livreur — null tant que le colis n'a jamais été reporté.
  dateNouvelleLivraison: string | null;
  // § /admin/scan/reception : hub où le colis a été réceptionné au quai
  // (POST /api/commandes/scan-reception) — null avant le scan.
  hubActuelId: string | null;
  dateReceptionHub: string | null;
  marchand?: { nomBoutique: string };
  livreur?: { id: string; nomComplet: string } | null;
  ramasseur?: { id: string; nomComplet: string } | null;
  ramassage?: { ramasseur?: { nomComplet: string } | null } | null;
  marchandise?: { id: string; nom: string; prix: string } | null;
  produit?: { id: string; nom: string; reference: string; photoUrl: string | null } | null;
  colisARemplacer?: { id: string; codeSuivi: string } | null;
  hubActuel?: { id: string; nom: string; ville: string } | null;
  historique?: HistoriqueStatut[];
  commentaires?: CommentaireCommande[];
}

// Alias dérivé de l'union ci-dessus plutôt qu'une seconde liste à maintenir :
// tout ajout de statut sur Commande se propage automatiquement.
export type StatutCommande = Commande['statut'];

export interface Marchandise {
  id: string;
  marchandId: string;
  nom: string;
  qteStock: number;
  prix: string;
  dateCreation: string;
}

export interface ProduitVariante {
  id: string;
  produitId: string;
  nom: string;
  reference: string;
  quantiteEnCours: number;
  quantiteRecue: number;
  rayonnage: string | null;
}

export interface HistoriqueProduit {
  id: string;
  produitId: string;
  texte: string;
  dateCreation: string;
  // Auteur du mouvement. Null sur les lignes antérieures à la traçabilité
  // (migration 20260826110000) : l'écran affiche « — » plutôt que d'inventer
  // un nom. Optionnel car toutes les routes ne le sélectionnent pas.
  utilisateur?: { nomComplet: string } | null;
}

export interface Produit {
  id: string;
  marchandId: string;
  nom: string;
  reference: string;
  quantiteEnCours: number;
  quantiteRecue: number;
  statutReception: 'pas_encore_recu' | 'recu';
  rayonnage: string | null;
  note: string | null;
  photoUrl: string | null;
  variantesActivees: boolean;
  dateCreation: string;
  variantes?: ProduitVariante[];
  historique?: HistoriqueProduit[];
  marchand?: { nomBoutique: string };
}

export interface HistoriqueStatut {
  id: string;
  ancienStatut: string | null;
  nouveauStatut: string;
  horodatage: string;
  // § /admin/scan/reception et /admin/bon-envoi : renseignés sur les entrées
  // recu_au_hub / en_transit liées à un hub.
  hubId?: string | null;
  note?: string | null;
  utilisateur?: { nomComplet: string };
  hub?: { nom: string } | null;
}

export interface CommentaireCommande {
  id: string;
  commandeId: string;
  texte: string;
  dateCreation: string;
  utilisateur?: { nomComplet: string };
}

export interface AdresseMarchand {
  id: string;
  marchandId: string;
  libelle: string;
  adresseComplete: string;
  estParDefaut: boolean;
}

export interface Marchand {
  id: string;
  utilisateurId: string;
  nomBoutique: string;
  raisonSociale: string | null;
  iceRc: string | null;
  ville: string | null;
  statut: 'en_attente_validation' | 'actif' | 'suspendu';
  typeCompte: 'marchand' | 'entreprise' | 'dropshipping';
  cin: string | null;
  siteWeb: string | null;
  adresse: string | null;
  nomBanque: string | null;
  rib: string | null;
  ribPhotoUrl: string | null;
  villeRamassage: string | null;
  registreCommerce: string | null;
  ramassageRecurrentActif: boolean;
  ramassageJours: string | null;
  ramassageCreneauHoraire: string | null;
  // § Facturation marchand : frais appliqués à toute ville sans ligne dans
  // TarifMarchandVille. `null` = aucun frais par défaut, distinct de "0".
  fraisLivraison?: string | null;
  fraisRetour?: string | null;
  dateCreation: string;
  utilisateur?: {
    id?: string;
    nomComplet: string;
    telephone: string | null;
    email?: string | null;
    actif: boolean;
    dateCreation?: string;
    derniereConnexion?: string | null;
  };
  adresses?: AdresseMarchand[];
  membres?: MarchandMembre[];
  _count?: { commandes: number; ramassages: number; marchandises: number };
}

export interface Ramassage {
  id: string;
  marchandId: string;
  adresseId: string;
  datePrevue: string;
  creneauHoraire: string | null;
  modeCreation: 'recurrent' | 'manuel';
  nbColisEstimes: number | null;
  nbColisReels: number;
  ramasseurId: string | null;
  statut: 'en_attente' | 'confirmee' | 'effectuee' | 'annulee';
  marchand?: { nomBoutique: string };
  adresse?: { libelle: string; adresseComplete: string };
  ramasseur?: { nomComplet: string } | null;
  commandes?: Commande[];
  _count?: { commandes: number };
}

export interface BonDeLivraison {
  id: string;
  numero: string;
  marchandId: string;
  nbColis: number;
  montantTotalCod: string;
  dateGeneration: string;
  commandes?: Commande[];
  marchand?: { nomBoutique: string; utilisateur?: { nomComplet: string; telephone: string | null } };
}

export interface BonDePreparation {
  id: string;
  numero: string;
  marchandId: string;
  nbColis: number;
  statut: 'en_attente' | 'validee';
  dateGeneration: string;
  dateValidation: string | null;
  validateurId: string | null;
  commandes?: Commande[];
  marchand?: { nomBoutique: string; utilisateur?: { nomComplet: string; telephone: string | null } };
  validateur?: { nomComplet: string } | null;
}

export interface BonEnvoi {
  id: string;
  numero: string;
  hubDestinationId: string;
  statut: 'nouveau' | 'recu';
  nbColis: number;
  dateGeneration: string;
  dateReception: string | null;
  receptionnaireId: string | null;
  commandes?: Commande[];
  hubDestination?: { nom: string };
  receptionnaire?: { nomComplet: string } | null;
}

// § Étape 1 du wizard de création (GET /api/bons-distribution/zones) : un
// Hub existant, enrichi des compteurs propres au module. Le hub sert
// directement de "zone" — cf. lib/bon-distribution.ts.
export interface HubDistribution {
  id: string;
  nom: string;
  nbColisAuHub: number;
  nbLivreursActifs: number;
}

export interface BonDistribution {
  id: string;
  numero: string;
  livreurId: string;
  hubId: string;
  statut: 'nouveau' | 'en_cours' | 'cloture';
  nbColis: number;
  dateGeneration: string;
  commandes?: Commande[];
  livreur?: { nomComplet: string; telephone?: string | null };
  hub?: { nom: string; ville?: string };
  planner?: { nomComplet: string } | null;
  // Bloc de reddition, renseigné uniquement quand statut === 'cloture'
  // (§ clôture de tournée). Les montants transitent en string : ce sont des
  // Decimal côté Prisma, sérialisés tels quels par NextResponse.json.
  dateCloture?: string | null;
  cloturePar?: { nomComplet: string } | null;
  nbColisLivres?: number | null;
  nbColisRetournes?: number | null;
  montantCrbtAttendu?: string | null;
  montantRemis?: string | null;
  ecartCaisse?: string | null;
  gainLivreur?: string | null;
}

// Réponse de GET /api/bons-distribution/[id]/bilan : le décompte présenté au
// Planner au retour du livreur (§ clôture de tournée). Miroir de l'interface
// BilanTournee côté serveur (lib/bon-distribution.ts).
export interface ColisTournee {
  id: string;
  codeSuivi: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  villeId: string | null;
  adresse: string;
  montantCod: string;
  statut: StatutCommande;
  motifRetour: string | null;
  dateNouvelleLivraison: string | null;
  dateLivraison: string | null;
  marchand?: { nomBoutique: string };
  // Ville du hub où le colis se trouve physiquement — sert à afficher
  // « Retourné au Hub (Casablanca) » plutôt qu'un « Retourné au Hub » sans
  // lieu (cf. StatutBadge).
  hubActuel?: { ville: string } | null;
}

export interface BilanTournee {
  bonId: string;
  numero: string;
  statut: 'nouveau' | 'en_cours' | 'cloture';
  dateGeneration: string;
  dateCloture: string | null;
  hub: { id: string; nom: string; ville: string };
  livreur: { id: string; nomComplet: string; telephone: string | null };
  nbColis: number;
  colisLivres: ColisTournee[];
  montantCrbtAttendu: number;
  colisARecuperer: ColisTournee[];
  colisRetournes: ColisTournee[];
  gainLivreur: number;
  detailGain: { libelle: string; nb: number; tarifMoyen: number; total: number }[];
  pretACloturer: boolean;
}

export interface Utilisateur {
  id: string;
  nomComplet: string;
  telephone: string | null;
  email?: string | null;
  role: string;
  actif: boolean;
  dateCreation: string;
  derniereConnexion?: string | null;
  cin?: string | null;
  photoUrl?: string | null;
  zonePrincipale?: string | null;
  zoneSecondaire?: string | null;
  adresse?: string | null;
  nomBanque?: string | null;
  numeroCompte?: string | null;
  fraisLivraison?: string | null;
  fraisRefus?: string | null;
  cinRectoUrl?: string | null;
  cinVersoUrl?: string | null;
  ribPhotoUrl?: string | null;
  rolesSupplementaires?: string[];
  // Permissions du back-office détenues par le compte (clés du catalogue de
  // lib/permissions.ts). Absent pour les comptes marchand/terrain, que le
  // catalogue ne gouverne pas.
  permissions?: string[];
  // § /admin/scan/reception + /admin/bon-distribution : hub de rattachement,
  // obligatoire pour un agent_hub ou un livreur.
  hubId?: string | null;
  hub?: { id: string; nom: string } | null;
}

export interface TarifLivreurVille {
  id: string;
  utilisateurId: string;
  villeId: string;
  fraisLivraison: string;
  fraisRefus: string;
  ville?: { id: string; nom: string };
}

export interface MarchandMembre {
  id: string;
  marchandId: string;
  dateAjout: string;
  utilisateur: { id: string; nomComplet: string; email: string | null; actif: boolean };
}

export interface Ville {
  id: string;
  nom: string;
  hubId: string;
  // § Sous-traitance : tarif d'achat de la livraison chez le prestataire qui
  // exploite le hub couvrant cette ville — null sur un hub interne, où c'est
  // TarifLivreurVille qui dit le coût. Montant sérialisé en chaîne (Decimal).
  tarifPrestataire?: string | null;
  // Tarif de retour du même prestataire — souvent absent des grilles
  // fournisseurs. Tant qu'il manque, le coût d'un colis retourné dans cette
  // ville est INCONNU en facturation (cf. Facture.nbLignesCoutInconnu).
  tarifPrestataireRetour?: string | null;
  // Toute la grille de la ville, tous prestataires confondus (§ /api/hubs) :
  // permet de comparer ce que coûterait une ville chez un autre prestataire
  // que celui qui la dessert aujourd'hui.
  tarifsPrestataires?: TarifPrestataireVille[];
}

export interface TarifPrestataireVille {
  id: string;
  prestataireId: string;
  villeId: string;
  tarifLivraison: string;
  tarifRetour: string | null;
  prestataire?: { id: string; nom: string };
}

// § Sous-traitance (/admin/hubs) — société externe qui livre pour nous. Ses
// points de dépôt sont des Hub rattachés (`agences`), pas une entité à part.
export interface Prestataire {
  id: string;
  nom: string;
  contact: string | null;
  telephone: string | null;
  email: string | null;
  actif: boolean;
  agences?: { id: string; nom: string; ville: string; nbVilles: number }[];
  nbVillesTarifees?: number;
}

export interface Hub {
  id: string;
  nom: string;
  ville: string;
  adresse: string | null;
  telephone: string | null;
  isCentral: boolean;
  // Null = hub interne (livreurs et ramasseurs maison, § /admin/bon-distribution) ;
  // renseigné = agence d'un prestataire, qui livre lui-même ses villes.
  prestataireId: string | null;
  prestataire?: { id: string; nom: string; actif: boolean } | null;
  villes?: Ville[];
  nbColisDepot?: number;
}

export interface EquipeTacheMembre {
  id: string;
  dateAjout: string;
  utilisateur: { id: string; nomComplet: string; email: string | null; role: string; actif: boolean };
}

export interface EquipeTache {
  id: string;
  code: string;
  nom: string;
  couleur: string;
  membres?: EquipeTacheMembre[];
}

// Étiquette de tâche (§ /admin/tasks) : catalogue tenu en base, servi par
// /api/taches/etiquettes. Les tâches n'en stockent que le `code`.
export interface Etiquette {
  id: string;
  code: string;
  nom: string;
  couleur: string;
  dateCreation?: string;
}

export interface CommentaireTache {
  id: string;
  tacheId: string;
  texte: string;
  mentionIds: string[];
  dateCreation: string;
  auteur?: { id: string; nomComplet: string };
}

export interface Tache {
  id: string;
  numero: number;
  titre: string;
  description: string | null;
  statut: 'a_faire' | 'en_cours' | 'termine';
  priorite: 'faible' | 'moyenne' | 'elevee';
  progress: number;
  etiquettes: string[];
  teamId: string;
  assigneeId: string | null;
  createurId: string;
  dateEcheance: string | null;
  dateCreation: string;
  bloque: boolean;
  raisonBlocage: string | null;
  team?: EquipeTache;
  assignee?: { id: string; nomComplet: string } | null;
  createur?: { id: string; nomComplet: string };
  commentaires?: CommentaireTache[];
  historiqueStatuts?: HistoriqueStatutTache[];
  piecesJointes?: PieceJointeTache[];
  _count?: { commentaires: number };
}

export interface HistoriqueStatutTache {
  id: string;
  ancienStatut: 'a_faire' | 'en_cours' | 'termine' | null;
  nouveauStatut: 'a_faire' | 'en_cours' | 'termine';
  utilisateurId: string;
  utilisateur?: { id: string; nomComplet: string };
  horodatage: string;
}

export interface PieceJointeTache {
  id: string;
  tacheId: string;
  nom: string;
  url: string;
  auteurId: string;
  auteur?: { id: string; nomComplet: string };
  dateAjout: string;
}

export interface MembreTache {
  id: string;
  nomComplet: string;
  role: string;
}

export interface Transaction {
  id: string;
  montant: string;
  type: 'revenu' | 'depense';
  categorie: 'paiement_client' | 'frais_livraison' | 'abonnement_outil' | 'salaire' | 'remboursement' | 'autre';
  dateEffet: string;
  description: string | null;
  auteurId: string;
  estAnnulee: boolean;
  transactionOrigineId: string | null;
  dateCreation: string;
  auteur?: { nomComplet: string; role: string };
  transactionOrigine?: { id: string; categorie: string } | null;
  annulation?: { id: string } | null;
}

// ============================================================
// Espace livreur (§ /livreur/colis — PATCH /api/livreur/colis/[id]/statut)
// ============================================================

// Les 3 actions de livraison exposées côté mobile — distinctes du PATCH
// générique /api/commandes/[id]/statut (back-office, 27 statuts libres) :
// chacune ne couvre qu'une transition précise avec ses propres champs requis.
export type ActionLivreur = 'livre' | 'reporte' | 'annule';

// Motifs fermés proposés à l'action "Reporté" (dropdown, pas de texte libre)
// — stockés dans Commande.motifRetour, avec Commande.dateNouvelleLivraison
// pour la date de nouvelle tentative.
export const MOTIFS_REPORT_LIVREUR = ['Pas de réponse', 'Client absent', 'Adresse incomplète', 'Demande client'] as const;
export type MotifReportLivreur = (typeof MOTIFS_REPORT_LIVREUR)[number];

// Motifs fermés proposés à l'action "Annulé" — stockés dans Commande.motifRetour.
export const MOTIFS_ANNULATION_LIVREUR = ['Refusé', 'Endommagé', 'Annulé'] as const;
export type MotifAnnulationLivreur = (typeof MOTIFS_ANNULATION_LIVREUR)[number];

// Corps du PATCH /api/livreur/colis/[id]/statut, une forme par action.
export type ActionLivreurPayload =
  | { action: 'livre'; photoPreuveUrl?: string; signatureUrl?: string }
  | { action: 'reporte'; motif: MotifReportLivreur; dateNouvelleLivraison: string }
  | { action: 'annule'; motif: MotifAnnulationLivreur };

// Réponse de GET /api/livreur/caisse : récapitulatif du CRBT encaissé du jour.
export interface CaisseLivreurJour {
  commandes: Commande[];
  total: string;
}

// Réponse de GET /api/livreur/dashboard (§ /livreur, Accueil) : les 2 blocs de
// stats sur la plage de dates sélectionnée.
export interface DashboardLivreurStats {
  colis: { total: number; livres: number; retournes: number; tauxLivre: number; tauxRetourne: number };
  bonsDistribution: { total: number; nouveau: number; enCours: number; nbColisTotal: number };
}

export interface Reclamation {
  id: string;
  marchandId: string;
  commandeId: string | null;
  sujet: string;
  message: string;
  statut: 'ouverte' | 'en_cours' | 'resolue' | 'rejetee';
  reponse: string | null;
  dateCreation: string;
  dateReponse: string | null;
  marchand?: { nomBoutique: string };
  commande?: { id: string; codeSuivi: string } | null;
  utilisateur?: { nomComplet: string };
}

// ============================================================
// Facturation marchand (§ /admin/factures)
// ============================================================

// Les montants transitent en string : ce sont des Decimal côté Prisma,
// sérialisés tels quels par NextResponse.json — même convention que le bloc
// de reddition de BonDistribution ci-dessus.
export interface LigneFacture {
  id: string;
  commandeId: string;
  livre: boolean;
  montantCod: string;
  frais: string;
  commande?: {
    id: string;
    codeSuivi: string;
    clientNom: string;
    clientTelephone?: string;
    ville: string;
    statut: StatutCommande;
    dateLivraison: string | null;
  };
}

// Frais annexe saisi à la main sur une facture en brouillon (emballage,
// réexpédition…). Le montant est toujours positif et se RETRANCHE du net.
export interface FraisFacture {
  id: string;
  libelle: string;
  montant: string;
  dateCreation: string;
  creePar?: { nomComplet: string };
}

export type ModeReglementMarchand = 'virement' | 'especes' | 'cheque';

export interface Facture {
  id: string;
  numero: string;
  marchandId: string;
  statut: 'brouillon' | 'emise' | 'payee' | 'annulee';
  nbColisLivres: number;
  nbColisRetournes: number;
  totalCod: string;
  totalFraisLivraison: string;
  totalFraisRetour: string;
  totalAutresFrais: string;
  netAPayer: string;
  // § Marge — INTERNES, et donc OPTIONNELS ici : les réponses servies à une
  // session marchand les écartent dès la requête (cf. FACTURE_OMIT_COUTS,
  // lib/facturation.ts). Absents ne veut pas dire nuls, mais « pas pour vous ».
  totalCoutLivraison?: string;
  nbLignesCoutInconnu?: number;
  // dateEmission = création du document (brouillon compris) ;
  // dateValidation = passage brouillon → émise, quand les montants ont été figés.
  dateEmission: string;
  dateValidation: string | null;
  datePaiement: string | null;
  dateAnnulation: string | null;
  motifAnnulation: string | null;
  modeReglement: ModeReglementMarchand | null;
  referenceReglement: string | null;
  marchand?: {
    id: string;
    nomBoutique: string;
    raisonSociale?: string | null;
    iceRc?: string | null;
    ville?: string | null;
    adresse?: string | null;
    rib?: string | null;
    utilisateur?: { nomComplet: string; telephone: string | null; email: string | null };
  };
  emisePar?: { nomComplet: string };
  validePar?: { nomComplet: string } | null;
  transaction?: { id: string; dateEffet: string; montant: string } | null;
  lignes?: LigneFacture[];
  fraisAnnexes?: FraisFacture[];
}

// § /admin/factures/nouvelle, étape 1 « Clients à facturer » : un marchand
// ayant de la matière, avec de quoi décider s'il passe en premier.
export interface MarchandAFacturer {
  marchandId: string;
  nomBoutique: string;
  raisonSociale: string | null;
  ville: string | null;
  nbColisLivres: number;
  nbColisRetournes: number;
  totalCod: number;
  attenteDepuis: string | null;
}

// Une ligne de frais annexe telle que saisie à l'écran, avant enregistrement.
export interface FraisAnnexeSaisi {
  libelle: string;
  montant: number;
}

// Prévisualisation avant création — mêmes chiffres que ceux qui seront figés.
export interface PrevisualisationFacture {
  marchand: { id: string; nomBoutique: string; raisonSociale: string | null; ville: string | null };
  colis: Commande[];
  total: {
    lignes: {
      commandeId: string;
      livre: boolean;
      montantCod: number;
      frais: number;
      // § Marge — coût de la course, null quand il est inconnu. INTERNE : la
      // prévisualisation n'est servie qu'à l'admin et au responsable.
      coutLivraison: number | null;
      coutSource: 'livreur' | 'prestataire' | null;
    }[];
    nbColisLivres: number;
    nbColisRetournes: number;
    totalCod: number;
    totalFraisLivraison: number;
    totalFraisRetour: number;
    totalAutresFrais: number;
    netAPayer: number;
    totalCoutLivraison: number;
    nbLignesCoutInconnu: number;
  };
}

export interface TarifMarchandVille {
  id: string;
  marchandId: string;
  villeId: string;
  fraisLivraison: string;
  fraisRetour: string;
  ville?: { id: string; nom: string };
}

// ============================================================
// Bon de paiement livreur (§ /admin/bon-paiement)
// ============================================================

export interface LivreurARegler {
  id: string;
  nomComplet: string;
  telephone: string | null;
  hubId: string | null;
  hubNom: string | null;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montantDu: number;
}

export interface TourneeARegler {
  id: string;
  numero: string;
  dateGeneration: string;
  dateCloture: string | null;
  nbColisLivres: number | null;
  nbColisRetournes: number | null;
  gainLivreur: string | null;
  hub?: { id: string; nom: string } | null;
}

// Cycle de vie de la paie : brouillon (ajustable) -> valide (montant figé)
// -> paye (argent sorti). `annule` libère les tournées pour un nouveau bon.
export type StatutBonPaiement = 'brouillon' | 'valide' | 'paye' | 'annule';

export type ModeReglementLivreur = 'virement' | 'especes' | 'cheque';

export type TypeAjustementPaiement = 'prime' | 'penalite';

// Prime ou pénalité saisie à la main sur un bon en brouillon. `montant` est
// toujours positif — c'est `type` qui porte le signe.
export interface AjustementBonPaiement {
  id: string;
  type: TypeAjustementPaiement;
  libelle: string;
  montant: string;
  dateCreation: string;
  creePar?: { nomComplet: string };
}

export interface BonPaiement {
  id: string;
  numero: string;
  livreurId: string;
  hubId: string | null;
  statut: StatutBonPaiement;
  periodeDebut: string;
  periodeFin: string;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montantCommissions: string;
  totalAjustements: string;
  montantTotal: string;
  dateGeneration: string;
  dateValidation: string | null;
  dateReglement: string | null;
  dateAnnulation: string | null;
  motifAnnulation: string | null;
  modeReglement: ModeReglementLivreur | null;
  referenceReglement: string | null;
  livreur?: {
    id: string;
    nomComplet: string;
    telephone?: string | null;
    cin?: string | null;
    nomBanque?: string | null;
    numeroCompte?: string | null;
  };
  hub?: { nom: string; ville?: string } | null;
  emisPar?: { nomComplet: string };
  validePar?: { nomComplet: string } | null;
  transaction?: { id: string; dateEffet: string } | null;
  ajustements?: AjustementBonPaiement[];
  tournees?: TourneeARegler[];
  colis?: ColisPaye[];
}

// Une ligne de la fiche de paie : un colis, sa rémunération figée à la
// clôture de tournée, et sa nature (livré ou retourné) figée au même instant.
// `fraisLivreur` est nul pour les tournées clôturées avant l'introduction du
// détail au colis — affiché « — » plutôt que recalculé.
export interface ColisPaye {
  id: string;
  codeSuivi: string;
  clientNom: string;
  ville: string;
  montantCod: string;
  dateLivraison: string | null;
  fraisLivreur: string | null;
  fraisLivreurLivre: boolean | null;
  marchand?: { nomBoutique: string };
  bonDistribution?: { numero: string; dateCloture: string | null } | null;
}

// § Ma paie (/livreur/bons-paiement) — la réponse de
// GET /api/livreur/bons-paiement. Le livreur voit ses bons AVEC le détail de
// leurs ajustements : un net inférieur à ses commissions doit être motivé.
export interface BonPaiementLivreur {
  id: string;
  numero: string;
  statut: StatutBonPaiement;
  periodeDebut: string;
  periodeFin: string;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montantCommissions: string;
  totalAjustements: string;
  montantTotal: string;
  dateGeneration: string;
  dateValidation: string | null;
  dateReglement: string | null;
  dateAnnulation: string | null;
  motifAnnulation: string | null;
  modeReglement: ModeReglementLivreur | null;
  referenceReglement: string | null;
  hub: { nom: string } | null;
  ajustements: { id: string; type: TypeAjustementPaiement; libelle: string; montant: string }[];
}

// Mois dont les tournées sont clôturées mais qu'aucun bon n'a encore pris.
export interface PeriodeNonGeneree {
  annee: number;
  mois: number;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montant: number;
}

export interface PaieLivreur {
  totalDu: number;
  totalArrete: number;
  totalNonGenere: number;
  bons: BonPaiementLivreur[];
  periodesNonGenerees: PeriodeNonGeneree[];
}

// § Tableau de bord mensuel de la paie (/admin/bon-paiement) — la réponse de
// GET /api/bons-paiement/tableau-de-bord.
export type StatutPaieLivreur = 'paye' | 'en_attente' | 'non_genere' | 'sans_activite';

export interface LignePaieMensuelle {
  livreurId: string;
  nomComplet: string;
  telephone: string | null;
  hubNom: string | null;
  statutPaie: StatutPaieLivreur;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montantEnAttenteGeneration: number;
  bon: {
    id: string;
    numero: string;
    statut: StatutBonPaiement;
    montantTotal: number;
    dateReglement: string | null;
    modeReglement: ModeReglementLivreur | null;
  } | null;
}

export interface TableauDeBordPaie {
  annee: number;
  mois: number;
  periode: { debut: string; fin: string };
  kpis: {
    masseTotale: number;
    totalPaye: number;
    totalResteAPayer: number;
    totalNonGenere: number;
    nbLivreursPayes: number;
    nbLivreursEnAttente: number;
    nbLivreursNonGeneres: number;
  };
  lignes: LignePaieMensuelle[];
}

// ============================================================
// Bon de retour marchand (§ /admin/bon-retour, /ramasseur)
// ============================================================

export interface BonRetourColis {
  id: string;
  codeSuivi: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  montantCod: string;
  statut: StatutCommande;
  motifRetour: string | null;
}

export interface BilanBonRetour {
  nbColis: number;
  colisRemis: BonRetourColis[];
  colisRestants: BonRetourColis[];
  pretASigner: boolean;
}

export interface BonRetour {
  id: string;
  numero: string;
  marchandId: string;
  hubId: string | null;
  statut: 'nouveau' | 'en_cours' | 'remis';
  nbColis: number;
  montantTotalCod: string;
  dateGeneration: string;
  dateAffectation: string | null;
  dateRemise: string | null;
  nomSignataire: string | null;
  signatureUrl: string | null;
  photoDechargeUrl: string | null;
  ramasseurId: string | null;
  marchand?: {
    id: string;
    nomBoutique: string;
    ville?: string | null;
    adresse?: string | null;
    utilisateur?: { telephone: string | null };
  };
  hub?: { nom: string; ville?: string } | null;
  creePar?: { nomComplet: string };
  ramasseur?: { id: string; nomComplet: string; telephone?: string | null } | null;
  commandes?: BonRetourColis[];
  bilan?: BilanBonRetour;
}

// § Écran de composition : les marchands ayant des colis à restituer dans ce
// hub, pour que le Planner ouvre directement le bon lot.
export interface MarchandARestituer {
  marchandId: string;
  nomBoutique: string;
  nbColis: number;
  montantTotalCod: number;
}

// Étape 1 du wizard de composition d'un bon de retour (§ /api/bons-retour/zones)
// — pendant de HubDistribution, compté sur la matière du retour.
export interface HubRetour {
  id: string;
  nom: string;
  nbColisRestituables: number;
  nbRamasseursActifs: number;
}

export interface RamasseurDisponible {
  id: string;
  nomComplet: string;
  telephone: string | null;
  bonsEnCours: number;
}

// ============================================================
// Paramètres de la société (§ /admin/parametres)
// ============================================================

// Identité imprimée en en-tête de tous les documents sortants.
export interface ParametresSociete {
  raisonSociale: string;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  siteWeb: string | null;
  logoUrl: string | null;
}
