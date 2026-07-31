import { prisma } from '@/lib/prisma';
import { Package, Hourglass, PackageCheck, ClipboardList, Store } from 'lucide-react';
import { KpiCard } from '@/components/KpiCard';
import { DashboardChart, type VolumeJour } from '@/components/admin/DashboardChart';
import { AlertesPanel, type MarchandAlerte, type RamassageAlerte } from '@/components/admin/AlertesPanel';

const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

function jourCle(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function AdminDashboardPage() {
  const debut7j = new Date();
  debut7j.setHours(0, 0, 0, 0);
  debut7j.setDate(debut7j.getDate() - 6);

  const [
    totalColis,
    colisEnAttente,
    colisCollectes,
    demandesRamassageEnAttente,
    nouveauxMarchands,
    commandes7j,
    marchandsEnAttente,
    ramassagesEnAttente,
  ] = await Promise.all([
    prisma.commande.count(),
    prisma.commande.count({ where: { statut: 'nouveau_colis' } }),
    prisma.commande.count({ where: { statut: 'ramasse' } }),
    prisma.ramassage.count({ where: { statut: 'en_attente' } }),
    prisma.marchand.count({ where: { statut: 'en_attente_validation' } }),
    prisma.commande.findMany({
      where: { dateCreation: { gte: debut7j }, statut: { in: ['nouveau_colis', 'attente_de_ramassage', 'ramasse'] } },
      select: { dateCreation: true, statut: true },
    }),
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

  const jours: { date: string; label: string }[] = [];
  const volumeParJour = new Map<string, { nouveau_colis: number; attente_de_ramassage: number; ramasse: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(debut7j);
    d.setDate(d.getDate() + i);
    const cle = jourCle(d);
    jours.push({ date: cle, label: JOURS[d.getDay()] });
    volumeParJour.set(cle, { nouveau_colis: 0, attente_de_ramassage: 0, ramasse: 0 });
  }
  for (const c of commandes7j) {
    const cle = jourCle(c.dateCreation);
    const entry = volumeParJour.get(cle);
    if (entry && (c.statut === 'nouveau_colis' || c.statut === 'attente_de_ramassage' || c.statut === 'ramasse')) {
      entry[c.statut] += 1;
    }
  }
  const volume7j: VolumeJour[] = jours.map(({ date, label }) => ({
    date,
    label,
    ...(volumeParJour.get(date) ?? { nouveau_colis: 0, attente_de_ramassage: 0, ramasse: 0 }),
  }));

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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Accueil</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={Package} label="Total colis" value={totalColis.toLocaleString('fr-FR')} highlight />
        <KpiCard icon={Hourglass} label="Nouveaux colis" value={colisEnAttente.toLocaleString('fr-FR')} />
        <KpiCard icon={PackageCheck} label="Colis ramassés" value={colisCollectes.toLocaleString('fr-FR')} />
        <KpiCard
          icon={ClipboardList}
          label="Demandes de ramassage en attente"
          value={demandesRamassageEnAttente.toLocaleString('fr-FR')}
        />
        <KpiCard icon={Store} label="Nouveaux marchands à valider" value={nouveauxMarchands.toLocaleString('fr-FR')} />
      </div>

      <div className="dashboard-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide opacity-70">
          Volume quotidien des colis par statut — 7 derniers jours
        </h2>
        <DashboardChart data={volume7j} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide opacity-70">Alertes &amp; validation</h2>
        <AlertesPanel marchands={marchandsAlertes} ramassages={ramassagesAlertes} />
      </div>
    </div>
  );
}
