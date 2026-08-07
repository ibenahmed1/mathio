import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function upsertUtilisateur(telephone: string, nomComplet: string, secret: string, role: 'admin' | 'marchand' | 'equipe_suivi' | 'ramasseur', actif = true) {
  const motDePasseHash = await bcrypt.hash(secret, 10);
  return prisma.utilisateur.upsert({
    where: { telephone },
    update: {},
    create: { nomComplet, telephone, motDePasseHash, role, actif },
  });
}

type VilleSeed = { nom: string; type: 'principale' | 'satellite' };
type HubSeed = { nom: string; villes: VilleSeed[] };
type ZoneSeed = { code: string; nom: string; hubs: HubSeed[] };

// Découpage national zone → hub(s) → villes, utilisé pour le zonage des
// tournées (ramasseurs/livreurs). Une zone peut avoir plusieurs hubs
// régionaux (ex. Centre-Sud & Souss : Marrakech et Agadir).
const ZONAGE_LOGISTIQUE: ZoneSeed[] = [
  {
    code: 'hub_central',
    nom: 'Hub Central (Casa Grand Public & Périphérie)',
    hubs: [
      {
        nom: 'Casablanca / Nouaceur',
        villes: [
          { nom: 'Casablanca', type: 'principale' },
          { nom: 'Mohammédia', type: 'satellite' },
          { nom: 'Bouskoura', type: 'satellite' },
          { nom: 'Dar Bouazza', type: 'satellite' },
          { nom: 'Tit Mellil', type: 'satellite' },
          { nom: 'Médiouna', type: 'satellite' },
          { nom: 'Berrechid', type: 'satellite' },
          { nom: 'Settat', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'nord',
    nom: 'Nord (Axe Tanger-Tétouan)',
    hubs: [
      {
        nom: 'Tanger',
        villes: [
          { nom: 'Tanger', type: 'principale' },
          { nom: 'Tétouan', type: 'principale' },
          { nom: 'Larache', type: 'satellite' },
          { nom: 'Ksar El Kébir', type: 'satellite' },
          { nom: 'Asilah', type: 'satellite' },
          { nom: 'Chefchaouen', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'centre_atlantique',
    nom: 'Centre-Atlantique (Axe Capitale / Littoral)',
    hubs: [
      {
        nom: 'Rabat / Salé',
        villes: [
          { nom: 'Rabat', type: 'principale' },
          { nom: 'Salé', type: 'principale' },
          { nom: 'Témara', type: 'satellite' },
          { nom: 'Skhirat', type: 'satellite' },
          { nom: 'Kénitra', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'centre_sud_souss',
    nom: 'Centre-Sud & Souss',
    hubs: [
      {
        nom: 'Marrakech',
        villes: [
          { nom: 'Marrakech', type: 'principale' },
          { nom: 'Safi', type: 'satellite' },
          { nom: 'El Jadida', type: 'satellite' },
          { nom: 'Essaouira', type: 'satellite' },
          { nom: 'Kelâat Sraghna', type: 'satellite' },
          { nom: 'Ben Guerir', type: 'satellite' },
        ],
      },
      {
        nom: 'Agadir',
        villes: [
          { nom: 'Agadir', type: 'principale' },
          { nom: 'Inezgane', type: 'satellite' },
          { nom: 'Aït Melloul', type: 'satellite' },
          { nom: 'Taroudant', type: 'satellite' },
          { nom: 'Tiznit', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'oriental',
    nom: 'Oriental',
    hubs: [
      {
        nom: 'Oujda / Nador',
        villes: [
          { nom: 'Oujda', type: 'principale' },
          { nom: 'Nador', type: 'principale' },
          { nom: 'Berkane', type: 'satellite' },
          { nom: 'Taourirt', type: 'satellite' },
          { nom: 'Al Hoceïma', type: 'satellite' },
          { nom: 'Guercif', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'interieur_saiss',
    nom: 'Intérieur / Saïss',
    hubs: [
      {
        nom: 'Fès / Meknès',
        villes: [
          { nom: 'Fès', type: 'principale' },
          { nom: 'Meknès', type: 'principale' },
          { nom: 'Taza', type: 'satellite' },
          { nom: 'Ifrane', type: 'satellite' },
          { nom: 'Azrou', type: 'satellite' },
          { nom: 'Khénifra', type: 'satellite' },
        ],
      },
    ],
  },
  {
    code: 'sud_sahara',
    nom: 'Sud / Sahara',
    hubs: [
      {
        nom: 'Laâyoune',
        villes: [
          { nom: 'Laâyoune', type: 'principale' },
          { nom: 'Guelmim', type: 'satellite' },
          { nom: 'Tan-Tan', type: 'satellite' },
          { nom: 'Dakhla', type: 'satellite' },
        ],
      },
    ],
  },
];

async function seedZonageLogistique() {
  for (const zoneSeed of ZONAGE_LOGISTIQUE) {
    const zone = await prisma.zoneLogistique.upsert({
      where: { code: zoneSeed.code },
      update: { nom: zoneSeed.nom },
      create: { code: zoneSeed.code, nom: zoneSeed.nom },
    });

    for (const hubSeed of zoneSeed.hubs) {
      const hub = await prisma.hubRegional.upsert({
        where: { nom: hubSeed.nom },
        update: { zoneId: zone.id },
        create: { nom: hubSeed.nom, zoneId: zone.id },
      });

      for (const villeSeed of hubSeed.villes) {
        await prisma.ville.upsert({
          where: { nom: villeSeed.nom },
          update: { type: villeSeed.type, hubId: hub.id },
          create: { nom: villeSeed.nom, type: villeSeed.type, hubId: hub.id },
        });
      }
    }
  }
}

type EquipeTacheSeed = { code: string; nom: string; couleur: string };

const EQUIPES_TACHES: EquipeTacheSeed[] = [
  { code: 'dev', nom: 'Développement', couleur: 'blue' },
  { code: 'admin', nom: 'Administration', couleur: 'violet' },
  { code: 'gestionnaire', nom: 'Gestionnaires / Hub', couleur: 'emerald' },
  { code: 'design', nom: 'Design', couleur: 'pink' },
];

async function seedEquipesTaches() {
  for (const equipe of EQUIPES_TACHES) {
    await prisma.equipeTache.upsert({
      where: { code: equipe.code },
      update: { nom: equipe.nom, couleur: equipe.couleur },
      create: equipe,
    });
  }
}

// Mot de passe de test partagé par les comptes créés ci-dessous — à changer
// avant tout déploiement au-delà d'un environnement de dev/démo.
const MOT_DE_PASSE_TEST = 'Test1234!';

async function upsertUtilisateurEmail(
  email: string,
  nomComplet: string,
  role: 'admin' | 'superviseur' | 'moderateur' | 'equipe_suivi' | 'responsable' | 'design' | 'gestionnaire_hub'
) {
  const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE_TEST, 10);
  return prisma.utilisateur.upsert({
    where: { email },
    update: {},
    create: { nomComplet, email, motDePasseHash, role, actif: true },
  });
}

async function ajouterMembreEquipe(equipeCode: string, utilisateurId: string) {
  const equipe = await prisma.equipeTache.findUniqueOrThrow({ where: { code: equipeCode } });
  await prisma.equipeTacheMembre.upsert({
    where: { equipeId_utilisateurId: { equipeId: equipe.id, utilisateurId } },
    update: {},
    create: { equipeId: equipe.id, utilisateurId },
  });
}

// Personnel interne back-office (§ /admin/tasks) demandé pour tester le
// Kanban : rôle applicatif mappé sur le Role enum existant (pas de rôles
// dédiés SUPER_ADMIN/DEV/HUB_MANAGER/DESIGN pour l'instant — l'équipe Kanban
// ci-dessous reste le vrai découpage métier visible dans l'UI).
async function seedPersonnelInterne() {
  const basma = await upsertUtilisateurEmail('basma.boutaib@mathio.test', 'Basma Boutaib', 'admin');
  const mustapha = await upsertUtilisateurEmail('mustapha.ibenahmed@mathio.test', 'Mustapha Ibenahmed', 'admin');
  const anas = await upsertUtilisateurEmail('anas.aouragh@mathio.test', 'Anas Aouragh', 'admin');
  const oumaima = await upsertUtilisateurEmail('oumaima.souidi@mathio.test', 'Oumaima Souidi', 'admin');
  // Cantonnés au Kanban (§ /admin/tasks) uniquement, cf. ROLES_KANBAN_UNIQUEMENT
  // dans lib/auth.ts — rôle aligné sur leur équipe Kanban respective.
  const ibrahim = await upsertUtilisateurEmail('ibrahim@mathio.test', 'Ibrahim', 'gestionnaire_hub');
  const mourad = await upsertUtilisateurEmail('mourad@mathio.test', 'Mourad', 'design');

  await ajouterMembreEquipe('dev', basma.id);
  await ajouterMembreEquipe('dev', mustapha.id);
  await ajouterMembreEquipe('admin', anas.id);
  await ajouterMembreEquipe('admin', oumaima.id);
  await ajouterMembreEquipe('gestionnaire', ibrahim.id);
  await ajouterMembreEquipe('design', mourad.id);

  return { basma, mustapha, anas, oumaima, ibrahim, mourad };
}

async function main() {
  await seedZonageLogistique();
  await seedEquipesTaches();

  const admin = await upsertUtilisateur('0000000000', 'Administrateur', '1234', 'admin');

  const marchandUser = await upsertUtilisateur('0611111111', 'Marchand Démo', 'Marchand123!', 'marchand');
  const marchand = await prisma.marchand.upsert({
    where: { utilisateurId: marchandUser.id },
    update: {},
    create: {
      utilisateurId: marchandUser.id,
      nomBoutique: 'Boutique Démo',
      ville: 'Casablanca',
      statut: 'actif', // déjà approuvé pour pouvoir tester immédiatement
      ramassageRecurrentActif: true,
      ramassageJours: 'lun,mar,mer,jeu,ven',
      ramassageCreneauHoraire: '17:00-19:00',
    },
  });

  const adresse = await prisma.adresseMarchand.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      marchandId: marchand.id,
      libelle: 'Entrepôt principal',
      adresseComplete: '12 rue Test, Casablanca',
      estParDefaut: true,
    },
  });

  const agent = await upsertUtilisateur('0622222222', 'Équipe de Suivi Démo', 'Agent123!', 'equipe_suivi');
  const ramasseur = await upsertUtilisateur('0633333333', 'Ramasseur Démo', '1234', 'ramasseur');

  const personnel = await seedPersonnelInterne();

  // Carte "Commandes d'inventaire" (§ /admin/comptabilite) : deux exemples
  // d'achats d'équipement/consommables pour les hubs.
  const responsableHub = await upsertUtilisateurEmail('responsable.hub@mathio.test', 'Responsable Hub', 'responsable');
  await prisma.commandeStockHub.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      titre: 'Rayonnage Métallique Lourd (x6)',
      sousTitre: 'Aménagement Zone de Stockage Casa',
      montant: 3200.0,
      statut: 'livre',
      modePaiement: 'Virement Bancaire',
      dateCommande: new Date('2026-08-05'),
      auteurId: admin.id,
    },
  });
  await prisma.commandeStockHub.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      titre: "Rouleaux Scotch & Pouches d'expédition (x500)",
      sousTitre: 'Consommables & Préparation colis',
      montant: 650.0,
      statut: 'en_attente',
      modePaiement: 'Espèces Hub',
      dateCommande: new Date('2026-08-07'),
      auteurId: responsableHub.id,
    },
  });

  console.log({
    admin: { telephone: admin.telephone },
    marchand: { telephone: marchandUser.telephone, id: marchand.id },
    adresse: { id: adresse.id },
    agent: { telephone: agent.telephone },
    ramasseur: { telephone: ramasseur.telephone },
    personnelInterne: {
      motDePasse: MOT_DE_PASSE_TEST,
      comptes: Object.values(personnel).map((u) => ({ email: u.email, nomComplet: u.nomComplet, role: u.role })),
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
