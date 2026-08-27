import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPageSession } from '@/lib/auth';
import { getColisDuBon } from '@/lib/bon-paiement';
import { getParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';
import { EnteteSociete } from '@/components/EnteteSociete';

// § Bon de paiement livreur — fiche de paie mensuelle, signée à la remise de
// l'argent.
//
// Le détail est au COLIS et non à la tournée : c'est le niveau auquel un
// livreur conteste (« ce colis-là, je l'ai bien livré »), et le seul qui
// justifie le montant ligne à ligne. Le récapitulatif par tournée reste en
// pied de tableau pour le rapprochement comptable.
//
// Deux espaces y accèdent, avec deux portées différentes :
//   admin   — la comptabilité, sur n'importe quel bon ;
//   terrain — le LIVREUR, sur les siens uniquement (§ /livreur/bons-paiement).
// Le contrôle de propriété se fait après chargement, sur `livreurId` : sans
// lui, tout livreur lirait la paie d'un collègue en changeant l'identifiant
// dans l'URL.
export default async function BonPaiementPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getPageSession(['admin', 'terrain']);
  if (!session || !['admin', 'responsable', 'livreur'].includes(session.role)) {
    redirect('/login');
  }

  const [bon, colis, societe] = await Promise.all([
    prisma.bonPaiement.findUnique({
      where: { id },
      include: {
        livreur: true,
        hub: true,
        emisPar: { select: { nomComplet: true } },
        ajustements: { orderBy: { dateCreation: 'asc' } },
        tournees: { select: { id: true, numero: true }, orderBy: { dateCloture: 'asc' } },
      },
    }),
    getColisDuBon(id),
    getParametresSociete(),
  ]);

  if (!bon) {
    notFound();
  }

  // `notFound` plutôt qu'un 403 : un livreur qui tâtonne sur des identifiants
  // ne doit pas pouvoir déduire de la réponse qu'un bon existe pour un
  // collègue. Même convention que les autres documents à portée restreinte
  // (cf. la garde marchand de /factures/[id]).
  if (session.role === 'livreur' && bon.livreurId !== session.sub) {
    notFound();
  }

  const fmt = (v: unknown) => `${Number(v).toFixed(2)} DH`;
  const jour = (v: Date | null) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');
  const jourHeure = (v: Date | null) =>
    v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const periode = bon.periodeDebut.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const MODES = { virement: 'Virement', especes: 'Espèces', cheque: 'Chèque' } as const;

  return (
    <div className="mx-auto max-w-4xl bg-white p-10 text-black">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          .no-print { display: none !important; }
          /* Une paie mensuelle peut porter plusieurs centaines de colis : les
             en-têtes se répètent en haut de chaque page, et aucune ligne n'est
             coupée en deux. */
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
      <AutoPrint />

      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">FICHE DE PAIE LIVREUR</h1>
          <p className="font-mono text-sm">{bon.numero}</p>
          <p className="mt-1 text-sm font-bold uppercase">Période : {periode}</p>
          <p className="mt-1 text-xs">
            Établie le {jourHeure(bon.dateGeneration)} par {bon.emisPar.nomComplet}
          </p>
        </div>
        <EnteteSociete societe={societe}>
          {bon.hub && (
            <p className="mt-1 text-xs">
              Hub {bon.hub.nom}
              {bon.hub.ville && ` — ${bon.hub.ville}`}
            </p>
          )}
          {bon.statut === 'paye' && (
            <p className="mt-2 inline-block border border-green-700 px-2 py-0.5 text-xs font-bold uppercase text-green-700">
              Payé le {jour(bon.dateReglement)}
            </p>
          )}
          {bon.statut === 'annule' && (
            <p className="mt-2 inline-block border border-black px-2 py-0.5 text-xs font-bold uppercase">Annulé</p>
          )}
          {bon.statut === 'brouillon' && (
            <p className="mt-2 inline-block border border-black px-2 py-0.5 text-xs font-bold uppercase">
              Brouillon — montant non arrêté
            </p>
          )}
        </EnteteSociete>
      </header>

      <section className="mt-5 text-sm">
        <p className="text-xs uppercase tracking-wide opacity-60">Bénéficiaire</p>
        <p className="font-bold">{bon.livreur.nomComplet}</p>
        {bon.livreur.telephone && <p className="text-xs">Tél. {bon.livreur.telephone}</p>}
        {bon.livreur.cin && <p className="text-xs">CIN : {bon.livreur.cin}</p>}
        {bon.livreur.numeroCompte && (
          <p className="text-xs">
            RIB : <span className="font-mono">{bon.livreur.numeroCompte}</span>
            {bon.livreur.nomBanque && ` — ${bon.livreur.nomBanque}`}
          </p>
        )}
      </section>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1.5">N°</th>
            <th>Code d&apos;envoi</th>
            <th>Client</th>
            <th>Ville</th>
            <th>Date de livraison</th>
            <th>Statut</th>
            <th className="text-right">CRBT</th>
            <th className="text-right">Frais</th>
          </tr>
        </thead>
        <tbody>
          {colis.map((c, index) => (
            <tr key={c.id} className="border-b border-black/15">
              <td className="py-1 tabular-nums">{index + 1}</td>
              <td className="font-mono font-bold">{c.codeSuivi}</td>
              <td>{c.clientNom}</td>
              <td>{c.ville}</td>
              <td>{jourHeure(c.dateLivraison ?? c.bonDistribution?.dateCloture ?? null)}</td>
              <td>{c.fraisLivreurLivre === false ? 'Retourné' : 'Livré'}</td>
              {/* Le CRBT est affiché pour information : le livreur l'a remis
                  intégralement au dépôt à la clôture de sa tournée, il n'entre
                  pas dans le net ci-dessous. Un colis retourné n'a rien
                  encaissé. */}
              <td className="text-right tabular-nums">
                {c.fraisLivreurLivre === false ? '—' : fmt(c.montantCod)}
              </td>
              {/* « — » plutôt qu'un montant reconstitué quand le frais n'a pas
                  été figé : ces tournées ont été clôturées avant l'introduction
                  du détail au colis, et le recalculer avec la grille
                  d'aujourd'hui inventerait un chiffre. Le total reste juste, il
                  vient du gain figé. */}
              <td className="text-right tabular-nums">
                {c.fraisLivreur === null ? '—' : fmt(c.fraisLivreur)}
              </td>
            </tr>
          ))}
          {colis.length === 0 && (
            <tr>
              <td colSpan={8} className="py-3 text-center opacity-60">
                Aucun colis rattaché à ce bon.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="mt-2 text-xs opacity-60">
        Tournées couvertes : {bon.tournees.map((t) => t.numero).join(', ') || '—'}
      </p>

      {/* Les ajustements ne s'impriment que s'il y en a : sur la grande
          majorité des fiches, un bloc vide « Primes et pénalités : néant »
          n'apporterait rien et allongerait la page. */}
      {bon.ajustements.length > 0 && (
        <section className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wide">Primes et pénalités</p>
          <table className="mt-1 w-full border-collapse text-xs">
            <tbody>
              {bon.ajustements.map((a) => (
                <tr key={a.id} className="border-b border-black/15">
                  <td className="py-1">{a.libelle}</td>
                  <td className="text-right tabular-nums">
                    {a.type === 'penalite' ? '−' : '+'}
                    {fmt(a.montant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-5 flex justify-end">
        <table className="w-72 text-sm">
          <tbody>
            <tr>
              <td className="py-0.5">Tournées de la période</td>
              <td className="py-0.5 text-right tabular-nums">{bon.nbTournees}</td>
            </tr>
            <tr>
              <td className="py-0.5">Colis livrés</td>
              <td className="py-0.5 text-right tabular-nums">{bon.nbColisLivres}</td>
            </tr>
            <tr>
              <td className="py-0.5">Colis retournés</td>
              <td className="py-0.5 text-right tabular-nums">{bon.nbColisRetournes}</td>
            </tr>
            <tr className="border-t border-black/30">
              <td className="pt-1">Total commissions</td>
              <td className="pt-1 text-right tabular-nums">{fmt(bon.montantCommissions)}</td>
            </tr>
            {Number(bon.totalAjustements) !== 0 && (
              <tr>
                <td className="py-0.5">Ajustements</td>
                <td className="py-0.5 text-right tabular-nums">
                  {Number(bon.totalAjustements) >= 0 ? '+' : '−'}
                  {fmt(Math.abs(Number(bon.totalAjustements)))}
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-black font-black">
              <td className="pt-1.5">NET À VERSER</td>
              <td className="pt-1.5 text-right tabular-nums">{fmt(bon.montantTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {bon.statut === 'paye' && (
        <p className="mt-4 text-xs">
          Réglé par <span className="font-bold">{bon.modeReglement ? MODES[bon.modeReglement] : '—'}</span>
          {bon.referenceReglement && (
            <>
              {' '}
              — référence <span className="font-mono">{bon.referenceReglement}</span>
            </>
          )}
          .
        </p>
      )}

      <p className="mt-6 text-xs opacity-70">
        Ce montant correspond à la rémunération des colis ci-dessus, calculée colis par colis au tarif en
        vigueur au moment de leur livraison. Il est indépendant du CRBT collecté, remis en intégralité au
        dépôt à la clôture de chaque tournée.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
        <div>
          <p className="border-b border-black pb-8">{societe.raisonSociale}</p>
          <p className="mt-1 opacity-60">Cachet et signature</p>
        </div>
        <div>
          <p className="border-b border-black pb-8">{bon.livreur.nomComplet}</p>
          <p className="mt-1 opacity-60">Reçu la somme ci-dessus</p>
        </div>
      </div>
    </div>
  );
}
