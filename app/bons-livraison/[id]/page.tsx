import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { buildParcelLabels, type ParcelLabel } from '@/lib/parcel-label';
import type { Prisma } from '@/app/generated/prisma/client';
import { AutoPrint } from './AutoPrint';

type BonAvecDetails = Prisma.BonDeLivraisonGetPayload<{
  include: { marchand: { include: { utilisateur: true } }; commandes: true };
}>;
type Commande = BonAvecDetails['commandes'][number];

export default async function BonDeLivraisonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format } = await searchParams;

  const session = await getPageSession();
  if (!session) {
    redirect('/login');
  }

  const bon = await prisma.bonDeLivraison.findUnique({
    where: { id },
    include: {
      marchand: { include: { utilisateur: true } },
      commandes: { orderBy: { codeSuivi: 'asc' } },
    },
  });

  if (!bon) {
    notFound();
  }

  if (session.role === 'marchand') {
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand || marchand.id !== bon.marchandId) {
      redirect('/marchand/bons-livraison');
    }
  }

  return format === 'etiquettes' ? <VueEtiquettes bon={bon} /> : <VueRecapA4 bon={bon} />;
}

async function VueRecapA4({ bon }: { bon: BonAvecDetails }) {
  const totalCod = bon.commandes.reduce((sum, c) => sum + Number(c.montantCod), 0);
  const labels = await buildParcelLabels(bon.commandes);

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
            alt="Mathio Delivery"
            width={56}
            height={56}
            className="h-14 w-14 rounded-lg object-cover"
          />
          <div>
            <p className="text-xs font-bold tracking-[0.2em] opacity-70">MATHIO DELIVERY</p>
            <p className="text-2xl font-black leading-tight">Bon de Livraison</p>
          </div>
        </div>
        <p className="text-sm">Généré le {bon.dateGeneration.toLocaleDateString('fr-FR')}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-black/70 p-3">
          <p className="font-bold">{bon.marchand.nomBoutique}</p>
          <p>{bon.marchand.utilisateur.nomComplet}</p>
          <p>{bon.marchand.utilisateur.telephone ?? bon.marchand.utilisateur.email ?? ''}</p>
        </div>
        <div className="rounded border border-black/70 p-3">
          <p>
            <span className="font-semibold">Bon de livraison : </span>
            <span className="font-mono">{bon.numero}</span>
          </p>
          <p>
            <span className="font-semibold">Colis : </span>
            {bon.commandes.length}
          </p>
          <p>
            <span className="font-semibold">Total : </span>
            {totalCod.toFixed(2)} DH
          </p>
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-2">N°</th>
            <th className="py-2">Code d&apos;envoi</th>
            <th className="py-2">Destinataire</th>
            <th className="py-2">Ville</th>
            <th className="py-2 text-right">Crbt</th>
          </tr>
        </thead>
        <tbody>
          {bon.commandes.map((c, i) => (
            <tr key={c.id} className="border-b border-black/20">
              <td className="py-2 align-top">{i + 1}</td>
              <td className="py-2 align-top">
                <p className="font-mono">{c.codeSuivi}</p>
                <p className="font-mono text-xs opacity-60">{labels.get(c.codeSuivi)?.serial}</p>
              </td>
              <td className="py-2 align-top">{c.clientNom}</td>
              <td className="py-2 align-top">{c.ville}</td>
              <td className="py-2 text-right align-top">{Number(c.montantCod).toFixed(2)} DH</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-2" colSpan={4}>
              Total — {bon.commandes.length} colis
            </td>
            <td className="py-2 text-right">{totalCod.toFixed(2)} DH</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-16 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="mb-12 font-semibold">Signature Marchand</p>
          <div className="border-t border-black" />
        </div>
        <div>
          <p className="mb-12 font-semibold">Signature Ramasseur</p>
          <div className="border-t border-black" />
        </div>
      </div>
    </div>
  );
}

async function VueEtiquettes({ bon }: { bon: BonAvecDetails }) {
  const labels = await buildParcelLabels(bon.commandes);

  return (
    <div className="bg-white text-black">
      <style>{`
        @page { size: 100mm 150mm; margin: 5mm; }
        @media print { .etiquette { break-after: page; } .etiquette:last-child { break-after: auto; } }
      `}</style>
      <AutoPrint />

      {bon.commandes.map((c, i) => (
        <Etiquette key={c.id} bon={bon} commande={c} index={i} label={labels.get(c.codeSuivi)} />
      ))}
    </div>
  );
}

function Etiquette({
  bon,
  commande: c,
  index,
  label,
}: {
  bon: BonAvecDetails;
  commande: Commande;
  index: number;
  label?: ParcelLabel;
}) {
  const flags = [
    c.ouvrir && 'Ouvrir avant paiement',
    c.fragile && 'Fragile',
    c.aRemplacer && 'Échange',
  ].filter((flag): flag is string => Boolean(flag));

  return (
    <div className="etiquette mx-auto flex h-[140mm] w-[90mm] flex-col overflow-hidden rounded-md border-2 border-black bg-white text-black">
      {/* Bandeau transporteur */}
      <div className="flex items-center justify-between bg-black px-3.5 py-2 text-white">
        <span className="text-[11px] font-black tracking-[0.15em]">MATHIO DELIVERY</span>
        <span className="text-[10px] font-semibold opacity-80">
          Colis {index + 1}/{bon.commandes.length}
        </span>
      </div>
      <div className="h-1 w-full bg-brand" />

      <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
        <div className="flex items-baseline justify-between text-[10px] text-black/60">
          <span className="font-mono">{bon.numero}</span>
          <span>{bon.dateGeneration.toLocaleDateString('fr-FR')}</span>
        </div>

        <div className="text-[10px] leading-snug text-black/70">
          <p className="font-bold uppercase tracking-wide text-black/45">Expéditeur</p>
          <p className="font-semibold text-black">{bon.marchand.nomBoutique}</p>
          {bon.marchand.adresse && <p>{bon.marchand.adresse}</p>}
          {bon.marchand.ville && <p>{bon.marchand.ville}</p>}
        </div>

        {/* Destinataire — bloc mis en avant, comme sur une étiquette transporteur */}
        <div className="rounded-lg border-2 border-black p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-black/45">Livrer à</p>
          <p className="text-xl font-black leading-tight">{c.clientNom}</p>
          <p className="mt-1 text-sm">{c.adresse}</p>
          <p className="text-sm">
            {c.codePostal ? `${c.codePostal} ` : ''}
            {c.ville}
          </p>
          <p className="mt-1 text-sm font-bold">Tél. {c.clientTelephone}</p>
        </div>

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {flags.map((flag) => (
              <span
                key={flag}
                className="rounded-full bg-black px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              >
                {flag}
              </span>
            ))}
          </div>
        )}

        {/* Codes de suivi : QR sécurisé (numéro de série signé) + code-barres Code128 (scan entrepôt) */}
        <div className="mt-auto flex flex-col items-center gap-2 border-t border-dashed border-black/40 pt-3">
          <div className="flex items-center gap-3">
            {label && (
              <div
                className="h-[24mm] w-[24mm] shrink-0 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: label.qrSvg }}
              />
            )}
            <div className="text-left">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-black/45">N° de série</p>
              <p className="font-mono text-sm font-bold tracking-wider">{label?.serial}</p>
            </div>
          </div>
          {label && (
            <div
              className="h-[14mm] w-full [&>svg]:mx-auto [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: label.barcodeSvg }}
            />
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg bg-black px-4 py-2.5 text-white">
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
            À encaisser (COD)
          </span>
          <span className="text-xl font-black">{Number(c.montantCod).toFixed(2)} DH</span>
        </div>
      </div>
    </div>
  );
}
