Struct minimal (Kanban)

enum StatutTache { a_faire, en_cours, termine }
enum PrioriteTache { faible, moyenne, elevee }

interface EquipeTache {
  id: string;
  code: string;       // "dev" | "admin" | "gestionnaire" | "design"
  nom: string;
  couleur: string;     // "blue" | "violet" | "emerald" | "pink"
}

interface Tache {
  id: string;
  numero: number;
  titre: string;
  description?: string;
  statut: StatutTache;
  priorite: PrioriteTache;
  progress: number;        // 0-100
  etiquettes: string[];
  teamId: string;
  assigneeId?: string;
  createurId: string;
  dateEcheance?: string;   // ISO date
  bloque: boolean;
  raisonBlocage?: string;
}
Données de test (exemple JSON)

{
  "equipes": [
    { "code": "dev", "nom": "Développement", "couleur": "blue" },
    { "code": "admin", "nom": "Administration", "couleur": "violet" },
    { "code": "gestionnaire", "nom": "Gestionnaires / Hub", "couleur": "emerald" },
    { "code": "design", "nom": "Design", "couleur": "pink" }
  ],
  "taches": [
    {
      "numero": 1,
      "titre": "Corriger le bug de synchronisation des scans",
      "statut": "a_faire",
      "priorite": "elevee",
      "progress": 0,
      "etiquettes": ["bug", "urgent"],
      "team": "dev",
      "assignee": "basma.boutaib@mathio.test",
      "bloque": false
    },
    {
      "numero": 2,
      "titre": "Refonte de la page profil marchand",
      "statut": "en_cours",
      "priorite": "moyenne",
      "progress": 45,
      "etiquettes": ["design"],
      "team": "design",
      "assignee": "mourad@mathio.test",
      "bloque": false
    },
    {
      "numero": 3,
      "titre": "Mise à jour du zonage logistique Sud",
      "statut": "termine",
      "priorite": "faible",
      "progress": 100,
      "etiquettes": ["logistique"],
      "team": "gestionnaire",
      "assignee": "ibrahim@mathio.test",
      "bloque": false
    }
  ]
}
Identifiants de test (issus de prisma/seed.ts)
Rôle	Identifiant	Mot de passe
admin	téléphone 0000000000	1234
marchand	téléphone 0611111111	Marchand123!
equipe_suivi	téléphone 0622222222	Agent123!
ramasseur	téléphone 0633333333	1234
admin (Basma)	basma.boutaib@mathio.test	Test1234!
admin (Mustapha)	mustapha.ibenahmed@mathio.test	Test1234!
admin (Anas)	anas.aouragh@mathio.test	Test1234!
admin (Oumaima)	oumaima.souidi@mathio.test	Test1234!
gestionnaire_hub (Kanban uniquement)	ibrahim@mathio.test	Test1234!
design (Kanban uniquement)	mourad@mathio.test	Test1234!
responsable	responsable.hub@mathio.test	Test1234!
⚠️ Ce sont des identifiants de seed/démo (Test1234! partagé) — à ne jamais utiliser tels quels en production. Si ce document part vers un tiers externe, pensez à retirer les mots de passe ou à les régénérer avant l'envoi.