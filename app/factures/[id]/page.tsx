import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { getParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';
import { EnteteSociete } from '@/components/EnteteSociete';

// § Facture marchand — vue d'impression partagée, servie à l'identique sur le
// domaine du back-office et sur celui des marchands (même schéma que
// /bons-livraison/[id]). L'espace n'est pas choisi ici : il découle de l'hôte
// servi, cette liste dit seulement sur quels hôtes la page a un sens.
//
// Tous les montants viennent des colonnes FIGÉES à l'émission, jamais d'un
// recalcul : une facture réimprimée dans deux ans doit afficher exactement les
// mêmes chiffres, même si la grille tarifaire a changé dix fois entre-temps.
export default async function FacturePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getPageSession(['admin', 'marchand']);
  if (!session) {
    redirect('/login');
  }

  const societe = await getParametresSociete();

  // Les coûts et la marge sont écartés dès la requête, y compris pour un admin :
  // cette page EST le document remis au marchand, et un chiffre qu'on ne charge
  // pas ne peut pas être imprimé par accident (cf. LigneFacture.coutLivraison).
  const facture = await prisma.facture.findUnique({
    where: { id },
    omit: { totalCoutLivraison: true, nbLignesCoutInconnu: true },
    include: {
      marchand: { include: { utilisateur: true } },
      emisePar: { select: { nomComplet: true } },
      validePar: { select: { nomComplet: true } },
      fraisAnnexes: { orderBy: { dateCreation: 'asc' } },
      lignes: {
        omit: { coutLivraison: true, coutSource: true },
        include: {
          commande: {
            select: { codeSuivi: true, clientNom: true, ville: true, dateLivraison: true },
          },
        },
        orderBy: { commande: { codeSuivi: 'asc' } },
      },
    },
  });

  if (!facture) {
    notFound();
  }

  if (session.role === 'marchand') {
    const marchand = await resolveMarchandForUser(session.sub);
    // Un brouillon n'a pas encore été arrêté : ses montants peuvent bouger,
    // et l'imprimer côté marchand reviendrait à lui remettre un document qui
    // ne l'engage pas encore. Même règle que GET /api/factures/[id].
    if (!marchand || marchand.id !== facture.marchandId || facture.statut === 'brouillon') {
      redirect('/marchand/factures');
    }
  } else if (!['admin', 'responsable'].includes(session.role)) {
    redirect('/login');
  }

  const LIBELLE_MODE = {
    virement: 'Virement',
    cheque: 'Chèque',
    especes: 'Espèces',
  } as const;

  const net = Number(facture.netAPayer);
  const jour = (d: Date | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  // `unknown` en entrée : côté Server Component les montants arrivent en
  // Decimal Prisma, côté sérialisé en string — un seul formateur pour les deux.
  const fmt = (v: unknown) => `${Number(v).toFixed(2)} DH`;

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-black">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          .no-print { display: none !important; }
        }
      `}</style>
      <AutoPrint />

      <header className="flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">FACTURE</h1>
          <p className="font-mono text-sm">{facture.numero}</p>
          <p className="mt-1 text-xs">
            {facture.dateValidation
              ? `Émise le ${jour(facture.dateValidation)} par ${facture.validePar?.nomComplet ?? facture.emisePar.nomComplet}`
              : `Préparée le ${jour(facture.dateEmission)} par ${facture.emisePar.nomComplet}`}
          </p>
        </div>
        <EnteteSociete societe={societe}>
          {/* Le tampon dit l'état du document sur le papier : une facture
              photocopiée au fond d'un classeur ne dit rien d'elle-même, et
              « brouillon » vs « réglée » est exactement ce qu'on vient y
              vérifier des mois plus tard. */}
          {facture.statut === 'brouillon' && (
            <p className="mt-2 inline-block border border-black/50 px-2 py-0.5 text-xs font-bold uppercase text-black/60">
              Brouillon — non émis
            </p>
          )}
          {facture.statut === 'payee' && facture.datePaiement && (
            <p className="mt-2 inline-block border border-green-700 px-2 py-0.5 text-xs font-bold uppercase text-green-700">
              Réglée le {jour(facture.datePaiement)}
            </p>
          )}
          {facture.statut === 'annulee' && (
            <p className="mt-2 inline-block border border-red-700 px-2 py-0.5 text-xs font-bold uppercase text-red-700">
              Annulée le {jour(facture.dateAnnulation)}
            </p>
          )}
        </EnteteSociete>
      </header>

      {facture.statut === 'annulee' && facture.motifAnnulation && (
        <p className="mt-4 border border-red-700 p-2 text-xs">
          <strong>Motif de l&apos;annulation :</strong> {facture.motifAnnulation}
        </p>
      )}

      <section className="mt-5 text-sm">
        <p className="text-xs uppercase tracking-wide opacity-60">Facturé à</p>
        <p className="font-bold">{facture.marchand.nomBoutique}</p>
        {facture.marchand.raisonSociale && <p>{facture.marchand.raisonSociale}</p>}
        {facture.marchand.adresse && <p>{facture.marchand.adresse}</p>}
        {facture.marchand.ville && <p>{facture.marchand.ville}</p>}
        {facture.marchand.iceRc && <p className="text-xs">ICE / RC : {facture.marchand.iceRc}</p>}
        {facture.marchand.utilisateur.telephone && (
          <p className="text-xs">Tél. {facture.marchand.utilisateur.telephone}</p>
        )}
      </section>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1.5">Code suivi</th>
            <th>Client</th>
            <th>Ville</th>
            <th>Livré le</th>
            <th className="text-right">COD</th>
            <th className="text-right">Frais</th>
          </tr>
        </thead>
        <tbody>
          {facture.lignes.map((l) => (
            <tr key={l.id} className="border-b border-black/15">
              <td className="py-1 font-mono">{l.commande.codeSuivi}</td>
              <td>{l.commande.clientNom}</td>
              <td>{l.commande.ville}</td>
              <td>
                {l.livre
                  ? l.commande.dateLivraison
                    ? new Date(l.commande.dateLivraison).toLocaleDateString('fr-FR')
                    : '—'
                  : 'Retourné'}
              </td>
              <td className="text-right tabular-nums">{l.livre ? fmt(l.montantCod) : '—'}</td>
              <td className="text-right tabular-nums">−{fmt(l.frais)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {facture.fraisAnnexes.length > 0 && (
        <section className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wide">Autres frais</p>
          <table className="mt-1 w-full border-collapse text-xs">
            <tbody>
              {facture.fraisAnnexes.map((fr) => (
                <tr key={fr.id} className="border-b border-black/15">
                  <td className="py-1">{fr.libelle}</td>
                  <td className="py-1 text-right tabular-nums">−{fmt(fr.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-5 flex justify-end">
        <table className="w-64 text-sm">
          <tbody>
            <tr>
              <td className="py-0.5">COD encaissé ({facture.nbColisLivres} colis)</td>
              <td className="py-0.5 text-right tabular-nums">{fmt(facture.totalCod)}</td>
            </tr>
            <tr>
              <td className="py-0.5">Frais de livraison</td>
              <td className="py-0.5 text-right tabular-nums">−{fmt(facture.totalFraisLivraison)}</td>
            </tr>
            <tr>
              <td className="py-0.5">Frais de retour ({facture.nbColisRetournes} colis)</td>
              <td className="py-0.5 text-right tabular-nums">−{fmt(facture.totalFraisRetour)}</td>
            </tr>
            {Number(facture.totalAutresFrais) > 0 && (
              <tr>
                <td className="py-0.5">Autres frais ({facture.fraisAnnexes.length} ligne(s))</td>
                <td className="py-0.5 text-right tabular-nums">−{fmt(facture.totalAutresFrais)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-black font-black">
              <td className="pt-1.5">{net >= 0 ? 'NET À PAYER' : 'SOLDE DÛ PAR LE MARCHAND'}</td>
              <td className="pt-1.5 text-right tabular-nums">{fmt(Math.abs(net))}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Réglée : on imprime COMMENT, pas seulement QUE. Un « payée » sans
          mode ni référence n'est opposable à personne le jour d'une
          contestation. Tant qu'elle ne l'est pas, on rappelle le RIB sur
          lequel le virement partira. */}
      {facture.statut === 'payee' && facture.modeReglement ? (
        <p className="mt-6 text-xs">
          Réglée par <strong>{LIBELLE_MODE[facture.modeReglement]}</strong> le{' '}
          {jour(facture.datePaiement)}
          {facture.referenceReglement && (
            <>
              {' '}
              — réf. <span className="font-mono">{facture.referenceReglement}</span>
            </>
          )}
        </p>
      ) : (
        facture.marchand.rib && (
          <p className="mt-6 text-xs">
            Virement sur RIB : <span className="font-mono">{facture.marchand.rib}</span>
            {facture.marchand.nomBanque && ` — ${facture.marchand.nomBanque}`}
          </p>
        )
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
        <div>
          <p className="border-b border-black pb-8">{societe.raisonSociale}</p>
          <p className="mt-1 opacity-60">Cachet et signature</p>
        </div>
        <div>
          <p className="border-b border-black pb-8">{facture.marchand.nomBoutique}</p>
          <p className="mt-1 opacity-60">Bon pour accord</p>
        </div>
      </div>
    </div>
  );
}
