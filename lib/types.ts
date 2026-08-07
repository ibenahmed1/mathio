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
  quantite: number;
  notes: string | null;
  colisARemplacerId: string | null;
  ouvrir: boolean;
  fragile: boolean;
  aRemplacer: boolean;
  enStock: boolean;
  montantCod: string;
  statut:
    | 'nouveau_colis'
    | 'attente_de_ramassage'
    | 'ramasse'
    | 'recu'
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
    | 'en_retour_par_amana'
    | 'annule'
    | 'annule_par_vendeur';
  etatPaiement: 'non_paye' | 'facture' | 'paye' | 'rembourse';
  aRisque: boolean;
  ramassageId: string | null;
  bonLivraisonId: string | null;
  livreurId: string | null;
  cinUrl: string | null;
  motifRetour: string | null;
  photoPreuveUrl: string | null;
  signatureUrl: string | null;
  dateCreation: string;
  dateCollecte: string | null;
  dateLivraison: string | null;
  marchand?: { nomBoutique: string };
  livreur?: { id: string; nomComplet: string } | null;
  ramassage?: { ramasseur?: { nomComplet: string } | null } | null;
  marchandise?: { id: string; nom: string; prix: string } | null;
  colisARemplacer?: { id: string; codeSuivi: string } | null;
  historique?: HistoriqueStatut[];
  commentaires?: CommentaireCommande[];
}

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
  utilisateur?: { nomComplet: string };
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
  type: 'principale' | 'satellite';
  hubId: string;
}

export interface HubRegional {
  id: string;
  nom: string;
  zoneId: string;
  villes?: Ville[];
}

export interface ZoneLogistique {
  id: string;
  code: string;
  nom: string;
  hubs?: HubRegional[];
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
