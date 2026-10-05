import 'dotenv/config';
import { prisma } from '../lib/prisma';
import {
  ENTREES_DEFAUT,
  LIBELLES_VERDICT,
  TAUX_DEFAUT,
  analyserScenario,
  normaliserEntrees,
  type EntreesSimulation,
} from '../lib/simulateur-rentabilite';

// Scénarios d'EXEMPLE pour voir l'onglet « Comparer » du simulateur de
// rentabilité (§ /admin/simulateur, /marchand/simulateur) avec des données.
//
//   npx tsx scripts/exemples-simulations.ts              insère (ou remplace)
//   npx tsx scripts/exemples-simulations.ts --supprimer  retire les exemples
//
// Carnets alimentés : celui du back-office, et ceux des boutiques de démo
// nommées ci-dessous (ignorées si elles n'existent pas). Les exemples se
// reconnaissent à leur préfixe : relancer le script les remplace, sans
// toucher aux scénarios saisis à la main.

const PREFIXE = 'Exemple — ';
const BOUTIQUES_DEMO = ['Démo Intégrations', 'Boutique Démo'];

// Cinq profils choisis pour couvrir les trois verdicts, et un produit vendu
// dans une autre devise (la comparaison ne départage alors plus les montants).
const EXEMPLES: { nom: string; entrees: Partial<EntreesSimulation> }[] = [
  {
    nom: 'Montre connectée X8',
    entrees: {},
  },
  {
    nom: 'Sérum anti-taches',
    entrees: {
      prixVente: 199,
      prixAchat: 1.2,
      fraisApproche: 0.4,
      budgetPub: 800,
      cpl: 1.8,
      tauxConfirmation: 75,
      tauxLivraison: 72,
      fraisEmballage: 4,
    },
  },
  {
    nom: 'Aspirateur sans fil',
    entrees: {
      prixVente: 499,
      prixAchat: 22,
      fraisApproche: 5,
      budgetPub: 1500,
      cpl: 3,
      tauxConfirmation: 60,
      tauxLivraison: 45,
      fraisLivraison: 40,
      fraisRetour: 15,
      fraisEmballage: 8,
    },
  },
  {
    nom: 'Lampe LED solaire',
    entrees: {
      prixVente: 99,
      prixAchat: 3.5,
      fraisApproche: 1,
      budgetPub: 600,
      cpl: 2.2,
      tauxConfirmation: 65,
      tauxLivraison: 60,
    },
  },
  {
    nom: 'Montre X8 (Arabie saoudite)',
    entrees: {
      deviseVente: 'SAR',
      prixVente: 129,
      budgetPub: 1000,
      cpl: 3.5,
      tauxConfirmation: 65,
      tauxLivraison: 70,
      coutCallCenter: 3,
      fraisEmballage: 2,
      fraisLivraison: 22,
      fraisRetour: 12,
    },
  },
];

async function main() {
  const supprimer = process.argv.includes('--supprimer');
  const boutiques = await prisma.marchand.findMany({
    where: { nomBoutique: { in: BOUTIQUES_DEMO } },
    select: { id: true, nomBoutique: true },
  });
  const carnets: { marchandId: string | null; libelle: string }[] = [
    { marchandId: null, libelle: 'back-office' },
    ...boutiques.map((b) => ({ marchandId: b.id, libelle: b.nomBoutique })),
  ];

  const retires = await prisma.simulationRentabilite.deleteMany({
    where: {
      nom: { startsWith: PREFIXE },
      OR: [{ marchandId: null }, { marchandId: { in: boutiques.map((b) => b.id) } }],
    },
  });
  console.log(`${retires.count} exemple(s) retiré(s).`);
  if (supprimer) return;

  for (const ex of EXEMPLES) {
    const entrees = normaliserEntrees({ ...ENTREES_DEFAUT, ...ex.entrees });
    const a = analyserScenario(entrees, TAUX_DEFAUT);
    const verdict = a.verdict ? LIBELLES_VERDICT[a.verdict.statut] : 'incomplet';
    console.log(
      `  ${ex.nom.padEnd(30)} ${verdict.padEnd(24)} profit ${Math.round(a.resultats.profit)} ${entrees.deviseVente}`
    );
  }

  for (const c of carnets) {
    await prisma.simulationRentabilite.createMany({
      data: EXEMPLES.map((ex) => ({
        nom: PREFIXE + ex.nom,
        entrees: { ...normaliserEntrees({ ...ENTREES_DEFAUT, ...ex.entrees }) },
        taux: { ...TAUX_DEFAUT },
        marchandId: c.marchandId,
      })),
    });
    console.log(`${EXEMPLES.length} exemples insérés dans le carnet : ${c.libelle}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
