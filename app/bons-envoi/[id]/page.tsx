import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { getParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';

// § "Voir en PDF" d'un Bon d'Envoi (menu Actions, cf. BonEnvoiActionsMenu) :
// même schéma que /bons-livraison/[id] (page top-level hors /admin, session
// revérifiée manuellement, AutoPrint) mais un BE n'a pas de marchand unique
// (il regroupe des colis de marchands potentiellement différents vers un même
// hub), donc l'en-tête affiche la destination plutôt qu'un encart marchand.
export default async function BonEnvoiDetailPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getPageSession('admin');
  if (!session) {
    redirect('/login');
  }

  const societe = await getParametresSociete();

  const bon = await prisma.bonEnvoi.findUnique({
    where: { id },
    include: {
      hubDestination: true,
      commandes: { include: { marchand: { select: { nomBoutique: true } } }, orderBy: { codeSuivi: 'asc' } },
    },
  });

  if (!bon) {
    notFound();
  }

  if (session.role === 'agent_hub') {
    const agent = await prisma.utilisateur.findUnique({ where: { id: session.sub }, select: { hubId: true } });
    if (agent?.hubId !== bon.hubDestinationId) {
      redirect('/admin/bon-envoi');
    }
  } else if (session.role !== 'admin') {
    redirect('/login');
  }

  const totalCod = bon.commandes.reduce((sum, c) => sum + Number(c.montantCod), 0);

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-black">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print { html, body { background: white; } }
      `}</style>
      <AutoPrint />

      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <Image
            src="/mathio.jpg"
            alt={societe.raisonSociale}
            width={56}
            height={56}
            className="h-14 w-14 rounded-lg object-cover"
          />
          <div>
            <p className="text-xs font-bold tracking-[0.2em] opacity-70">{societe.raisonSociale.toUpperCase()}</p>
            <p className="text-2xl font-black leading-tight">Bon d&apos;Envoi</p>
          </div>
        </div>
        <p className="text-sm">Généré le {bon.dateGeneration.toLocaleDateString('fr-FR')}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-black/70 p-3">
          <p className="font-bold">Destination</p>
          <p>{bon.hubDestination.nom}</p>
          <p className="opacity-70">{bon.hubDestination.ville}</p>
        </div>
        <div className="rounded border border-black/70 p-3">
          <p>
            <span className="font-semibold">Bon d&apos;envoi : </span>
            <span className="font-mono">{bon.numero}</span>
          </p>
          <p>
            <span className="font-semibold">Colis : </span>
            {bon.commandes.length}
          </p>
          <p>
            <span className="font-semibold">Total COD : </span>
            {totalCod.toFixed(2)} DH
          </p>
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-2">N°</th>
            <th className="py-2">Code d&apos;envoi</th>
            <th className="py-2">Marchand</th>
            <th className="py-2">Destinataire</th>
            <th className="py-2">Ville</th>
            <th className="py-2 text-right">Crbt</th>
          </tr>
        </thead>
        <tbody>
          {bon.commandes.map((c, i) => (
            <tr key={c.id} className="border-b border-black/20">
              <td className="py-2 align-top">{i + 1}</td>
              <td className="py-2 align-top font-mono">{c.codeSuivi}</td>
              <td className="py-2 align-top">{c.marchand?.nomBoutique ?? '—'}</td>
              <td className="py-2 align-top">{c.clientNom}</td>
              <td className="py-2 align-top">{c.ville}</td>
              <td className="py-2 text-right align-top">{Number(c.montantCod).toFixed(2)} DH</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-2" colSpan={5}>
              Total — {bon.commandes.length} colis
            </td>
            <td className="py-2 text-right">{totalCod.toFixed(2)} DH</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-16 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="mb-12 font-semibold">Signature Hub Départ</p>
          <div className="border-t border-black" />
        </div>
        <div>
          <p className="mb-12 font-semibold">Signature Hub Destination</p>
          <div className="border-t border-black" />
        </div>
      </div>
    </div>
  );
}
