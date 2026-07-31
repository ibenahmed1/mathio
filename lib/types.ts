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
  utilisateur?: { nomComplet: string; telephone: string | null; email?: string | null; actif: boolean };
  membres?: MarchandMembre[];
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
}

export interface MarchandMembre {
  id: string;
  marchandId: string;
  dateAjout: string;
  utilisateur: { id: string; nomComplet: string; email: string | null; actif: boolean };
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
