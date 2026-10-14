import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession, roleMatches, sessionHasPermission } from '@/lib/auth';
import { buildParcelLabels, type ParcelLabel } from '@/lib/parcel-label';
import { getParametresSociete } from '@/lib/societe';
import type { Prisma } from '@/app/generated/prisma/client';
import { AutoPrint } from '@/components/AutoPrint';

// § Circuit Shipeh (12/10/2026) — étiquettes 100 × 100 mm de colis choisis un
// par un, sans bon : un colis Shipeh ne passe plus par le bon de préparation,
// qui était le seul à imprimer l'étiquette à QR. Même format et même QR signé
// (lib/parcel-label.ts) que /bons-preparation/[id]?format=etiquettes ; c'est
// ce QR que l'agent stock scanne ensuite (POST /api/stock/scan-reception).
//
//   /etiquettes?ids=<id>,<id>,…
//
// Ouverte à tout compte du back-office qui consulte les colis (`colis:read`),
// l'agent stock compris.
const MAX_ETIQUETTES = 200;

const colisInclude = {
  marchand: { select: { nomBoutique: true } },
  produit: { select: { nom: true, reference: true, rayonnage: true } },
  variante: { select: { nom: true, reference: true, rayonnage: true } },
  lignes: {
    orderBy: { position: 'asc' },
    select: {
      libelle: true,
      sku: true,
      quantite: true,
      produit: { select: { rayonnage: true } },
      variante: { select: { rayonnage: true } },
    },
  },
} satisfies Prisma.CommandeInclude;

type ColisEtiquette = Prisma.CommandeGetPayload<{ include: typeof colisInclude }>;

// Ce que le préparateur prend sur l'étagère : les lignes du colis (colis
// multi-produits), sinon l'ancien produit unique.
function articles(c: ColisEtiquette): { nom: string; reference: string | null; rayonnage: string | null; quantite: number }[] {
  if (c.lignes.length > 0) {
    return c.lignes.map((l) => ({
      nom: l.libelle,
      reference: l.sku,
      rayonnage: l.variante?.rayonnage ?? l.produit?.rayonnage ?? null,
      quantite: l.quantite,
    }));
  }
  const nomProduit = c.produit?.nom ?? c.produitDescription ?? '—';
  return [
    {
      nom: c.variante ? `${nomProduit} — ${c.variante.nom}` : nomProduit,
      reference: c.variante?.reference ?? c.produit?.reference ?? null,
      rayonnage: c.variante?.rayonnage ?? c.produit?.rayonnage ?? null,
      quantite: c.quantite,
    },
  ];
}

export default async function EtiquettesPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const session = await getPageSession('admin');
  if (!session || !(roleMatches(session, ['admin']) || sessionHasPermission(session, 'colis:read'))) {
    redirect('/login');
  }

  const { ids } = await searchParams;
  const liste = (ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_ETIQUETTES);

  const [colis, societe] = await Promise.all([
    prisma.commande.findMany({ where: { id: { in: liste } }, include: colisInclude, orderBy: { codeSuivi: 'asc' } }),
    getParametresSociete(),
  ]);
  const labels = await buildParcelLabels(colis);

  if (colis.length === 0) {
    return <p className="p-6 text-center text-sm opacity-60">Aucun colis à imprimer.</p>;
  }

  return (
    <div className="doc-scroll">
      <div className="bg-white text-black">
        <style>{`
          @page { size: 100mm 100mm; margin: 0; }
          @media print { .etiquette { break-after: page; } .etiquette:last-child { break-after: auto; } }
        `}</style>
        <AutoPrint />
        {colis.map((c, i) => (
          <Etiquette
            key={c.id}
            commande={c}
            index={i}
            total={colis.length}
            label={labels.get(c.codeSuivi)}
            nomSociete={societe.raisonSociale}
          />
        ))}
      </div>
    </div>
  );
}

function Etiquette({
  commande: c,
  index,
  total,
  label,
  nomSociete,
}: {
  commande: ColisEtiquette;
  index: number;
  total: number;
  label?: ParcelLabel;
  nomSociete: string;
}) {
  const flags = [c.ouvrir && 'Ouvrir avant paiement', c.fragile && 'Fragile', c.aRemplacer && 'Échange'].filter(
    (flag): flag is string => Boolean(flag)
  );
  const contenu = articles(c);

  return (
    <div className="etiquette mx-auto flex h-[100mm] w-[100mm] flex-col overflow-hidden border-2 border-black bg-white p-[3mm] font-bold text-black">
      {/* Noir sur blanc, tout en gras : lisible sur imprimante thermique. */}
      <div className="flex items-center justify-between border-b-2 border-black pb-1 text-[12px]">
        <span className="font-black tracking-wider">{nomSociete.toUpperCase()}</span>
        <span>
          Colis {index + 1}/{total}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 pt-1.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-mono text-[13px] font-black">{c.codeSuivi}</span>
          <span>{c.dateCreation.toLocaleDateString('fr-FR')}</span>
        </div>

        <p className="text-[11px] leading-tight">EXPÉDITEUR : {c.marchand.nomBoutique}</p>

        <div className="border-b-2 border-black pb-1 text-[11px] leading-tight">
          {contenu.map((a, k) => (
            <p key={k}>
              {a.nom} · Qté {a.quantite} · Réf. {a.reference ?? '—'}
              {a.rayonnage && <> · Ray. {a.rayonnage}</>}
            </p>
          ))}
        </div>

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

        {flags.length > 0 && <p className="text-[12px] uppercase">{flags.join(' · ')}</p>}

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
