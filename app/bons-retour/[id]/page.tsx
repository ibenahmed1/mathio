/* eslint-disable @next/next/no-img-element */
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { getParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';
import { EnteteSociete } from '@/components/EnteteSociete';

// § Bon de retour — vue d'impression. C'est l'exemplaire que le ramasseur
// fait signer au marchand quand la signature à l'écran n'est pas possible, et
// la pièce justificative qu'on ressort en cas de litige sur un colis rendu.
//
// Servie sur le back-office, la web app Planner et l'espace marchand : les
// trois ont une raison légitime de la sortir. Le ramasseur, lui, signe dans
// son application.
//
// Les signatures sont stockées en data URL (cf. BonRetour.signatureUrl) :
// `next/image` refuserait ce format, d'où le <img> et la désactivation ciblée
// de la règle ESLint en tête de fichier.
export default async function BonRetourPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getPageSession(['admin', 'planner', 'marchand']);
  if (!session) {
    redirect('/login');
  }

  const societe = await getParametresSociete();

  const bon = await prisma.bonRetour.findUnique({
    where: { id },
    include: {
      marchand: { include: { utilisateur: true } },
      hub: true,
      creePar: { select: { nomComplet: true } },
      ramasseur: { select: { nomComplet: true, telephone: true } },
      commandes: { orderBy: { codeSuivi: 'asc' } },
    },
  });

  if (!bon) {
    notFound();
  }

  if (session.role === 'marchand') {
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand || marchand.id !== bon.marchandId || bon.statut === 'nouveau') {
      redirect('/marchand/bons-retour');
    }
  }

  const fmt = (v: unknown) => `${Number(v).toFixed(2)} DH`;
  const jour = (d: Date | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const jourHeure = (d: Date | null) =>
    d
      ? new Date(d).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  // Le statut est écrit en toutes lettres sur le papier : un bon photocopié au
  // fond d'un carton ne dit rien de lui-même, et « nouveau » vs « remis » est
  // précisément ce qu'on vient vérifier des mois plus tard.
  const ETAT = {
    nouveau: { texte: 'Non affecté', classe: 'border-black/40 text-black/60' },
    en_cours: { texte: 'En cours de restitution', classe: 'border-amber-600 text-amber-700' },
    remis: { texte: 'Remis et signé', classe: 'border-green-700 text-green-700' },
  }[bon.statut];

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-black">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          .no-print { display: none !important; }
          /* Un bon de retour peut porter plusieurs dizaines de colis : sans
             ces trois règles, l'en-tête du tableau ne se répète pas sur la
             page 2 et une ligne se coupe en deux au saut de page. */
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          .bloc-signature { break-inside: avoid; }
        }
      `}</style>
      <AutoPrint />

      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">BON DE RETOUR</h1>
          <p className="font-mono text-sm">{bon.numero}</p>
          <p className="mt-1 text-xs">
            Établi le {jourHeure(bon.dateGeneration)} par {bon.creePar.nomComplet}
          </p>
        </div>
        <EnteteSociete societe={societe} />
      </header>

      {/* Cartouche récapitulatif : les cinq chiffres qu'on cherche d'un coup
          d'œil sans lire le tableau — destinataire, hub d'origine, volume,
          valeur, état. Encadré parce qu'il doit rester lisible sur une
          photocopie ou une photo prise au téléphone. */}
      <section className="mt-5 grid grid-cols-2 gap-x-8 gap-y-1.5 border-2 border-black p-4 text-sm">
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Marchand :</span>
          <span>{bon.marchand.nomBoutique}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Hub d&apos;origine :</span>
          <span>{bon.hub ? `${bon.hub.nom}${bon.hub.ville ? ` — ${bon.hub.ville}` : ''}` : '—'}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Date :</span>
          <span>{jourHeure(bon.dateGeneration)}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Ramasseur :</span>
          <span>{bon.ramasseur?.nomComplet ?? 'Non affecté'}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Colis :</span>
          <span className="tabular-nums">{bon.nbColis}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-28 shrink-0 font-bold">Valeur COD :</span>
          <span className="tabular-nums">{fmt(bon.montantTotalCod)}</span>
        </div>
        <div className="col-span-2 flex gap-2 pt-1">
          <span className="w-28 shrink-0 font-bold">État :</span>
          <span className={`border px-2 py-0.5 text-xs font-bold uppercase ${ETAT.classe}`}>
            {ETAT.texte}
            {bon.statut === 'remis' && bon.dateRemise ? ` le ${jour(bon.dateRemise)}` : ''}
          </span>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-60">Restitué à</p>
          <p className="font-bold">{bon.marchand.nomBoutique}</p>
          {bon.marchand.raisonSociale && <p className="text-xs">{bon.marchand.raisonSociale}</p>}
          {bon.marchand.adresse && <p>{bon.marchand.adresse}</p>}
          {bon.marchand.ville && <p>{bon.marchand.ville}</p>}
          {bon.marchand.utilisateur.telephone && (
            <p className="text-xs">Tél. {bon.marchand.utilisateur.telephone}</p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide opacity-60">Transporté par</p>
          <p className="font-bold">{bon.ramasseur?.nomComplet ?? 'Non affecté'}</p>
          {bon.ramasseur?.telephone && <p className="text-xs">Tél. {bon.ramasseur.telephone}</p>}
          {bon.dateAffectation && (
            <p className="text-xs">Confié le {jourHeure(bon.dateAffectation)}</p>
          )}
        </div>
      </section>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="w-8 py-1.5 text-right">N°</th>
            <th className="pl-2">Code d&apos;envoi</th>
            <th>Client</th>
            <th>Ville</th>
            <th>Motif du retour</th>
            <th>Reçu au hub</th>
            <th className="text-right">Valeur COD</th>
            {/* Case à cocher pour le pointage à la main : le ramasseur qui n'a
                pas de réseau chez le marchand coche ici, et la photo de ce
                bon signé fait foi (§ BonRetour.photoDechargeUrl). */}
            <th className="w-6 text-center">✓</th>
          </tr>
        </thead>
        <tbody>
          {bon.commandes.map((c, i) => (
            <tr key={c.id} className="border-b border-black/15">
              <td className="py-1 text-right tabular-nums">{i + 1}</td>
              <td className="pl-2 font-mono font-bold">{c.codeSuivi}</td>
              <td>
                {c.clientNom}
                {c.clientTelephone && (
                  <span className="block text-[10px] opacity-60">{c.clientTelephone}</span>
                )}
              </td>
              <td>{c.ville}</td>
              <td>{c.motifRetour ?? LABELS_STATUT_COMMANDE[c.statut]}</td>
              <td className="tabular-nums">{jour(c.dateReceptionHub ?? c.dateCreation)}</td>
              <td className="text-right tabular-nums">{fmt(c.montantCod)}</td>
              <td className="text-center">
                <span className="inline-block h-3 w-3 border border-black align-middle" />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-black">
            <td className="pt-1.5" colSpan={6}>
              {bon.nbColis} colis restitué(s)
            </td>
            <td className="pt-1.5 text-right tabular-nums">{fmt(bon.montantTotalCod)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <p className="mt-5 text-xs">
        La signature ci-dessous vaut reconnaissance de la réception de l&apos;intégralité des colis listés.
        Les montants indiqués sont les valeurs déclarées à l&apos;expédition ; aucun n&apos;a été encaissé, et
        ce bon n&apos;emporte donc aucun mouvement d&apos;argent.
      </p>

      <div className="bloc-signature mt-8 grid grid-cols-2 gap-10 text-xs">
        <div>
          <p className="mb-1 opacity-60">Le transporteur</p>
          <p className="border-b border-black pb-8">{bon.ramasseur?.nomComplet ?? ''}</p>
        </div>
        <div>
          <p className="mb-1 opacity-60">Le marchand — nom, date et signature</p>
          {bon.signatureUrl ? (
            <div className="border-b border-black">
              <img src={bon.signatureUrl} alt="Signature du marchand" className="h-20 object-contain" />
            </div>
          ) : (
            <p className="border-b border-black pb-8">{bon.nomSignataire ?? ''}</p>
          )}
          {bon.nomSignataire && (
            <p className="mt-1 font-medium">
              {bon.nomSignataire}
              {bon.dateRemise ? ` — ${jourHeure(bon.dateRemise)}` : ''}
            </p>
          )}
        </div>
      </div>

      {bon.photoDechargeUrl && (
        <div className="mt-8">
          <p className="mb-1 text-xs opacity-60">Décharge papier signée</p>
          <img
            src={bon.photoDechargeUrl}
            alt="Photo de la décharge signée"
            className="max-h-96 w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
