import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function upsertUtilisateur(telephone: string, nomComplet: string, secret: string, role: 'admin' | 'marchand' | 'agent_confirmation' | 'ramasseur', actif = true) {
  const motDePasseHash = await bcrypt.hash(secret, 10);
  return prisma.utilisateur.upsert({
    where: { telephone },
    update: {},
    create: { nomComplet, telephone, motDePasseHash, role, actif },
  });
}

async function main() {
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

  const agent = await upsertUtilisateur('0622222222', 'Agent Confirmation Démo', 'Agent123!', 'agent_confirmation');
  const ramasseur = await upsertUtilisateur('0633333333', 'Ramasseur Démo', '1234', 'ramasseur');

  console.log({
    admin: { telephone: admin.telephone },
    marchand: { telephone: marchandUser.telephone, id: marchand.id },
    adresse: { id: adresse.id },
    agent: { telephone: agent.telephone },
    ramasseur: { telephone: ramasseur.telephone },
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
