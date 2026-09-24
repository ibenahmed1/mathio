import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession, roleMatches } from '@/lib/auth';
import { buildParcelLabels, type ParcelLabel } from '@/lib/parcel-label';
import type { Prisma } from '@/app/generated/prisma/client';
import { getParametresSociete, type ParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';

type BonAvecDetails = Prisma.BonDePreparationGetPayload<{
  include: {
    marchand: true;
    commandes: { include: { produit: { select: { nom: true; reference: true; rayonnage: true } } } };
  };
}>;
type Commande = BonAvecDetails['commandes'][number];

// Fiche de préparation (PDF/impression) — dédiée à la personne qui prépare
// physiquement le stock en entrepôt, donc volontairement dépourvue des
// coordonnées client (nom/téléphone/adresse) présentes sur le Bon de
// Livraison : seules les infos utiles au picking (référence produit,
// rayonnage, quantité) et à la répartition Hub local / transit figurent ici.
//
// Les vues `etiquettes` / `e-tickets` (mêmes formats que le Bon de Livraison,
// cf. app/bons-livraison/[id]/page.tsx) servent, elles, à l'emballage : une
// étiquette par colis à coller sur le carton avant qu'il ne rejoigne le
// circuit de livraison classique.
export default async function BonDePreparationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { id } = await params;
  const { format } = await searchParams;

  // § Gestion de stock : réservé à `admin` (cf. ADMIN_SEUL, components/admin/nav.ts
  // et requireUser(['admin']) sur les routes /api/bons-preparation/**) — pas
  // seulement l'espace back-office au sens large, contrairement à la plupart
  // des pages /admin/**.
  const session = await getPageSession('admin');
  if (!session || !roleMatches(session, ['admin'])) {
    redirect('/login');
  }

  const societe = await getParametresSociete();

  const bon = await prisma.bonDePreparation.findUnique({
    where: { id },
    include: {
      marchand: true,
      commandes: {
        orderBy: { codeSuivi: 'asc' },
        include: { produit: { select: { nom: true, reference: true, rayonnage: true } } },
      },
    },
  });

  if (!bon) {
    notFound();
  }

  if (format === 'etiquettes') return <VueEtiquettes bon={bon} societe={societe} />;
  if (format === 'e-tickets') return <VueETickets bon={bon} />;
  return <VueFichePreparation bon={bon} societe={societe} />;
}

function VueFichePreparation({ bon, societe }: { bon: BonAvecDetails; societe: ParametresSociete }) {
  const totalQuantite = bon.commandes.reduce((sum, c) => sum + c.quantite, 0);

  return (
    <div className="doc-scroll">
      {/* Au téléphone, le document garde sa largeur de page et défile dans ce
          cadre, au lieu d'élargir tout l'écran. À l'impression, le cadre et la
          largeur minimale s'effacent (cf. .doc-scroll / .doc-page dans
          globals.css) : la mise en page papier est inchangée. */}
    <div className="doc-page mx-auto max-w-3xl bg-white p-10 text-black">
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
            <p className="text-2xl font-black leading-tight">Fiche de Préparation</p>
          </div>
        </div>
        <p className="text-sm">Généré le {bon.dateGeneration.toLocaleDateString('fr-FR')}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-black/70 p-3">
          <p className="font-bold">{bon.marchand.nomBoutique}</p>
        </div>
        <div className="rounded border border-black/70 p-3">
          <p>
            <span className="font-semibold">Bon de préparation : </span>
            <span className="font-mono">{bon.numero}</span>
          </p>
          <p>
            <span className="font-semibold">Colis : </span>
            {bon.commandes.length} ({totalQuantite} article{totalQuantite > 1 ? 's' : ''})
          </p>
          <p>
            <span className="font-semibold">Statut : </span>
            {bon.statut === 'validee' ? 'Reçu' : 'En attente de réception'}
          </p>
        </div>
      </div>

      <table className="mt-6 w-full table-auto text-left text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-2 pr-3">N°</th>
            <th className="py-2 pr-3">Code de suivi</th>
            <th className="py-2 pr-3">Produit</th>
            <th className="py-2 pr-3">Référence</th>
            <th className="py-2 pr-3">Rayonnage</th>
            <th className="py-2 pr-3 text-right">Qté</th>
            <th className="py-2">Ville de destination</th>
          </tr>
        </thead>
        <tbody>
          {bon.commandes.map((c, i) => (
            <tr key={c.id} className="border-b border-black/20">
              <td className="py-2 pr-3 align-top">{i + 1}</td>
              <td className="py-2 pr-3 align-top font-mono">{c.codeSuivi}</td>
              <td className="py-2 pr-3 align-top">{c.produit?.nom ?? c.produitDescription ?? '—'}</td>
              <td className="py-2 pr-3 align-top font-mono text-xs">{c.produit?.reference ?? '—'}</td>
              <td className="py-2 pr-3 align-top">{c.produit?.rayonnage ?? '—'}</td>
              <td className="py-2 pr-3 text-right align-top">{c.quantite}</td>
              <td className="py-2 align-top">{c.ville}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-2 pr-3" colSpan={5}>
              Total — {bon.commandes.length} colis
            </td>
            <td className="py-2 pr-3 text-right">{totalQuantite}</td>
            <td className="py-2" />
          </tr>
        </tfoot>
      </table>

      <div className="mt-16 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="mb-12 font-semibold">Préparé par</p>
          <div className="border-t border-black" />
        </div>
        <div>
          <p className="mb-12 font-semibold">Date &amp; Signature</p>
          <div className="border-t border-black" />
        </div>
      </div>
    </div>
    </div>
  );
}

function VueETickets({ bon }: { bon: BonAvecDetails }) {
  return (
    <div className="bg-white p-6 text-black">
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print { .e-ticket { break-inside: avoid; } }
      `}</style>
      <AutoPrint />

      <div className="mx-auto flex max-w-md flex-col gap-4">
        {bon.commandes.map((c) => (
          <div key={c.id} className="e-ticket flex flex-col gap-4 rounded-lg border-2 border-black p-5">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest opacity-60">E-Ticket colis (stock)</p>
              <p className="mt-1 break-all font-mono text-2xl font-black tracking-widest">{c.codeSuivi}</p>
            </div>
            <div className="grid grid-cols-1 gap-1 border-t border-dashed border-black/30 pt-3 text-sm">
              <p>
                <span className="opacity-60">Magasin :</span> {bon.marchand.nomBoutique}
              </p>
              <p>
                <span className="opacity-60">Produit :</span> {c.produit?.nom ?? c.produitDescription ?? '—'}
              </p>
              <p>
                <span className="opacity-60">Référence :</span> {c.produit?.reference ?? '—'}
              </p>
              <p>
                <span className="opacity-60">Rayonnage :</span> {c.produit?.rayonnage ?? '—'}
              </p>
              <p>
                <span className="opacity-60">Quantité :</span> {c.quantite}
              </p>
              <p>
                <span className="opacity-60">Destinataire :</span> {c.clientNom}
              </p>
              <p>
                <span className="opacity-60">Téléphone :</span> {c.clientTelephone}
              </p>
              <p>
                <span className="opacity-60">Ville :</span> {c.ville}
              </p>
              <p>
                <span className="opacity-60">Montant COD :</span> {Number(c.montantCod).toFixed(2)} DH
              </p>
            </div>
          </div>
        ))}
        {bon.commandes.length === 0 && <p className="text-center opacity-60">Aucun colis dans ce bon.</p>}
      </div>
    </div>
  );
}

async function VueEtiquettes({ bon, societe }: { bon: BonAvecDetails; societe: ParametresSociete }) {
  const labels = await buildParcelLabels(bon.commandes);

  return (
    <div className="doc-scroll">
      {/* L'étiquette mesure 100 × 100 mm (≈ 378 px) : plus large qu'un
          téléphone de 320 px. Elle défile dans ce cadre plutôt que d'élargir la
          page ; à l'impression le cadre s'efface (cf. .doc-scroll dans globals.css). */}
    <div className="bg-white text-black">
      <style>{`
        @page { size: 100mm 100mm; margin: 0; }
        @media print { .etiquette { break-after: page; } .etiquette:last-child { break-after: auto; } }
      `}</style>
      <AutoPrint />

      {bon.commandes.map((c, i) => (
        <Etiquette
          key={c.id}
          bon={bon}
          commande={c}
          index={i}
          label={labels.get(c.codeSuivi)}
          nomSociete={societe.raisonSociale}
        />
      ))}
    </div>
    </div>
  );
}

function Etiquette({
  bon,
  commande: c,
  index,
  label,
  nomSociete,
}: {
  bon: BonAvecDetails;
  commande: Commande;
  index: number;
  label?: ParcelLabel;
  nomSociete: string;
}) {
  const flags = [
    c.ouvrir && 'Ouvrir avant paiement',
    c.fragile && 'Fragile',
    c.aRemplacer && 'Échange',
  ].filter((flag): flag is string => Boolean(flag));

  return (
    <div className="etiquette mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden border-2 border-black bg-white p-[3mm] font-bold text-black">
      {/* Noir sur blanc, tout en gras : lisible sur imprimante thermique. */}
      <div className="flex items-center justify-between border-b-2 border-black pb-1 text-[12px]">
        <span className="font-black tracking-wider">{nomSociete.toUpperCase()}</span>
        <span>
          Colis {index + 1}/{bon.commandes.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 pt-1.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-mono">{bon.numero}</span>
          <span>{bon.dateGeneration.toLocaleDateString('fr-FR')}</span>
        </div>

        <p className="text-[11px] leading-tight">EXPÉDITEUR : {bon.marchand.nomBoutique}</p>

        {/* Produit — utile à l'entrepôt lors de l'emballage */}
        <div className="border-b-2 border-black pb-1 text-[11px] leading-tight">
          <p>
            PRODUIT : {c.produit?.nom ?? c.produitDescription ?? '—'} · Qté {c.quantite}
          </p>
          <p>
            Réf. {c.produit?.reference ?? '—'}
            {c.produit?.rayonnage && <> · Rayonnage {c.produit.rayonnage}</>}
          </p>
        </div>

        {/* Destinataire — bloc mis en avant, comme sur une étiquette transporteur */}
        <div className="border-2 border-black px-2 py-1.5">
          <p className="text-[11px]">LIVRER À</p>
          <p className="text-lg font-black leading-tight">{c.clientNom}</p>
          <p className="text-[13px] leading-tight">{c.adresse}</p>
          <p className="text-[13px] leading-tight">
            {c.codePostal ? `${c.codePostal} ` : ''}
            {c.ville}
          </p>
          <p className="text-[13px]">Tél. {c.clientTelephone}</p>
        </div>

        {flags.length > 0 && (
          <p className="text-[12px] uppercase">{flags.join(' · ')}</p>
        )}

        {/* QR sécurisé (numéro de série signé) + montant à encaisser */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t-2 border-black pt-1.5">
          <div className="flex items-center gap-2">
            {label && (
              <div
                className="h-[18mm] w-[18mm] shrink-0 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: label.qrSvg }}
              />
            )}
            <div className="text-[11px] leading-tight">
              <p>N° DE SÉRIE</p>
              <p className="font-mono text-[12px]">{label?.serial}</p>
            </div>
          </div>
          <div className="border-2 border-black px-2 py-1 text-right">
            <p className="text-[11px]">À ENCAISSER</p>
            <p className="text-lg font-black leading-tight">{Number(c.montantCod).toFixed(2)} DH</p>
          </div>
        </div>
      </div>
    </div>
  );
}
