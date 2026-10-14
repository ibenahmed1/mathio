import { notFound, redirect } from 'next/navigation';
import { getPageSession } from '@/lib/auth';
import { releveVersement } from '@/lib/reglements-transporteurs';
import { getParametresSociete } from '@/lib/societe';
import { AutoPrint } from '@/components/AutoPrint';
import { EnteteSociete } from '@/components/EnteteSociete';

// § Relevé de règlement transporteur (décidé le 14/10/2026) — la pièce
// imprimée d'un versement : les colis livrés qu'il solde, ce qu'on attendait,
// ce qui est arrivé.
//
// « Relevé » et non « facture » : le transporteur nous VEND la livraison, c'est
// à lui de facturer ses frais. Ce document atteste seulement l'argent reçu.
//
// Le versement est clos dès son enregistrement (ses colis passent « payé » et
// ne peuvent plus entrer dans un autre) et ses montants sont figés : le relevé
// imprimé reste donc vrai. Une erreur se corrige en annulant le versement — le
// relevé s'imprime alors barré « ANNULÉ ».
//
// Hors de /admin pour imprimer sans la barre latérale ; le proxy ne gouverne
// pas ce chemin, d'où le contrôle de permission ici (même règle que l'écran
// /admin/reglements-transporteurs).
export default async function ReleveReglementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getPageSession(['admin']);
  if (!session) redirect('/login');
  if (!session.permissions.includes('comptabilite:write')) notFound();

  const [r, societe] = await Promise.all([releveVersement(id), getParametresSociete()]);
  if (!r) notFound();

  const fmt = (v: number) => `${v.toFixed(2)} DH`;
  const jour = (v: Date) => new Date(v).toLocaleDateString('fr-FR');
  const jourHeure = (v: Date) => new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const annule = r.annuleLe !== null;

  return (
    <div className="doc-scroll">
      <div className="doc-page mx-auto max-w-4xl bg-white p-10 text-black">
        <style>{`
          @media print {
            @page { margin: 12mm; }
            .no-print { display: none !important; }
            thead { display: table-header-group; }
            tr { break-inside: avoid; }
          }
        `}</style>
        <AutoPrint />

        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">RELEVÉ DE RÈGLEMENT</h1>
            <p className="font-mono text-sm">Versement n° {r.numero}</p>
            <p className="mt-1 text-sm font-bold">Versement du {jour(r.dateVersement)}</p>
            <p className="mt-1 text-xs">
              Enregistré le {jourHeure(r.creeLe)} par {r.auteur}
            </p>
          </div>
          <EnteteSociete societe={societe}>
            {annule ? (
              <p className="mt-2 inline-block border-2 border-red-700 px-2 py-0.5 text-xs font-black uppercase text-red-700">
                Annulé le {jour(r.annuleLe!)}
                {r.annulePar && ` par ${r.annulePar}`}
              </p>
            ) : (
              <p className="mt-2 inline-block border border-green-700 px-2 py-0.5 text-xs font-bold uppercase text-green-700">
                Reçu le {jour(r.dateVersement)}
              </p>
            )}
          </EnteteSociete>
        </header>

        <section className="mt-5 text-sm">
          <p className="text-xs uppercase tracking-wide opacity-60">Transporteur</p>
          <p className="font-bold">{r.transporteur}</p>
          {r.telephoneTransporteur && <p className="text-xs">Tél. {r.telephoneTransporteur}</p>}
        </section>

        {annule ? (
          <p className="mt-6 border-2 border-red-700 px-3 py-2 text-sm font-semibold text-red-700">
            Ce versement a été annulé : ses colis sont redevenus « à recevoir » et figureront sur un autre relevé.
            Ce document n&apos;atteste plus aucun paiement.
          </p>
        ) : (
          <table className="mt-6 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1.5">N°</th>
                <th>Code d&apos;envoi</th>
                <th>Client</th>
                <th>Ville</th>
                <th>Livré le</th>
                <th className="text-right">COD</th>
                <th className="text-right">Frais transporteur</th>
                <th className="text-right">Attendu</th>
              </tr>
            </thead>
            <tbody>
              {r.colis.map((c, i) => (
                <tr key={c.codeSuivi} className="border-b border-black/15">
                  <td className="py-1 tabular-nums">{i + 1}</td>
                  <td className="font-mono font-bold">{c.codeSuivi}</td>
                  <td>{c.clientNom}</td>
                  <td>{c.ville}</td>
                  <td>{jour(c.dateLivraison)}</td>
                  <td className="text-right tabular-nums">{fmt(c.montantCod)}</td>
                  {/* « — » : la grille du transporteur ne connaît pas la ville,
                      l'attendu vaut alors le COD entier. */}
                  <td className="text-right tabular-nums">
                    {c.fraisTransporteur === null ? '—' : fmt(c.fraisTransporteur)}
                  </td>
                  <td className="text-right tabular-nums">{fmt(c.montantAttendu)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="mt-5 flex justify-end">
          <table className="w-full max-w-80 text-sm">
            <tbody>
              {!annule && (
                <>
                  <tr>
                    <td className="py-0.5">Colis</td>
                    <td className="py-0.5 text-right tabular-nums">{r.colis.length}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">Total COD encaissé par le transporteur</td>
                    <td className="py-0.5 text-right tabular-nums">{fmt(r.totalCod)}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">Frais retenus par le transporteur</td>
                    <td className="py-0.5 text-right tabular-nums">−{fmt(r.totalFrais)}</td>
                  </tr>
                </>
              )}
              <tr className="border-t border-black/30">
                <td className="pt-1">Montant attendu</td>
                <td className="pt-1 text-right tabular-nums">{fmt(r.montantAttendu)}</td>
              </tr>
              <tr className="border-t-2 border-black font-black">
                <td className="pt-1.5">MONTANT REÇU</td>
                <td className="pt-1.5 text-right tabular-nums">{fmt(r.montantRecu)}</td>
              </tr>
              {/* L'écart n'est pas traité (question 26, SOUS_TRAITANCE.md) : il
                  est seulement constaté, et le dire sur le papier évite qu'on
                  le croie soldé. */}
              <tr className={r.ecart === 0 ? '' : 'font-bold'}>
                <td className="py-0.5">Écart (reçu − attendu)</td>
                <td className="py-0.5 text-right tabular-nums">
                  {r.ecart === 0 ? 'Aucun' : `${r.ecart > 0 ? '+' : '−'}${fmt(Math.abs(r.ecart))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {r.note && (
          <p className="mt-4 text-xs">
            Note : <span className="font-semibold">{r.note}</span>
          </p>
        )}
        <p className="mt-1 text-xs opacity-70">
          {r.aPreuve ? 'Photo du reçu bancaire conservée avec le versement.' : 'Aucune photo du reçu bancaire jointe.'}
        </p>

        <p className="mt-6 text-xs opacity-70">
          Le transporteur encaisse le COD des colis ci-dessus, retient ses frais au tarif de sa grille pour la ville
          du colis, figé à la livraison, et reverse le reste. Ce relevé atteste la somme reçue ; il ne tient pas lieu
          de facture des frais du transporteur.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
          <div>
            <p className="border-b border-black pb-8">{societe.raisonSociale}</p>
            <p className="mt-1 opacity-60">Reçu la somme ci-dessus — cachet et signature</p>
          </div>
          <div>
            <p className="border-b border-black pb-8">{r.transporteur}</p>
            <p className="mt-1 opacity-60">Bon pour accord</p>
          </div>
        </div>
      </div>
    </div>
  );
}
