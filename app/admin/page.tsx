import { prisma } from '@/lib/prisma';
import { chargerDashboardAccueil } from '@/lib/dashboard-accueil';
import { DashboardAccueil } from '@/components/admin/DashboardAccueil';
import { AlertesPanel, type MarchandAlerte, type RamassageAlerte } from '@/components/admin/AlertesPanel';

export default async function AdminDashboardPage() {
  // Le tableau de bord (§ lib/dashboard-accueil.ts) et les alertes sont
  // indépendants : on les charge de front plutôt qu'en cascade.
  const [dashboard, marchandsEnAttente, ramassagesEnAttente] = await Promise.all([
    chargerDashboardAccueil(),
    prisma.marchand.findMany({
      where: { statut: 'en_attente_validation' },
      orderBy: { dateCreation: 'desc' },
      take: 5,
      include: { utilisateur: { select: { nomComplet: true, telephone: true } } },
    }),
    prisma.ramassage.findMany({
      where: { statut: 'en_attente' },
      orderBy: { datePrevue: 'asc' },
      take: 5,
      include: { marchand: { select: { nomBoutique: true } }, adresse: { select: { libelle: true } } },
    }),
  ]);

  const marchandsAlertes: MarchandAlerte[] = marchandsEnAttente.map((m) => ({
    id: m.id,
    nomBoutique: m.nomBoutique,
    ville: m.ville,
    dateCreation: m.dateCreation.toISOString(),
    contactNom: m.utilisateur.nomComplet,
    contactTelephone: m.utilisateur.telephone,
  }));

  const ramassagesAlertes: RamassageAlerte[] = ramassagesEnAttente.map((r) => ({
    id: r.id,
    marchandNom: r.marchand.nomBoutique,
    adresseLibelle: r.adresse.libelle,
    datePrevue: r.datePrevue.toISOString(),
    creneauHoraire: r.creneauHoraire,
    nbColisEstimes: r.nbColisEstimes,
  }));

  // Le dashboard pose son propre fond d'un bord à l'autre (cf. isFullBleed
  // dans AdminShell). Les alertes passent par son `children` : posées à côté,
  // elles retombaient sur le fond de la coquille, avec une gouttière et un
  // écart qui ne correspondaient plus à ceux des rangées du tableau de bord.
  return (
    <DashboardAccueil {...dashboard}>
      <AlertesPanel marchands={marchandsAlertes} ramassages={ramassagesAlertes} />
    </DashboardAccueil>
  );
}
