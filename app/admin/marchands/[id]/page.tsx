'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { apiGet, apiPatch, apiDelete, apiPost } from '@/lib/api-client';
import type { Marchand } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { TarifsMarchandModal } from '@/components/admin/TarifsMarchandModal';
import { LABELS_TYPE_COMPTE } from '@/lib/marchand-form-options';
import { Affix, Field } from '@/components/form/Field';

function Champ({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</span>
      <span className="text-sm">{value ?? <span className="opacity-40">—</span>}</span>
    </div>
  );
}

export default function AdminMarchandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [marchand, setMarchand] = useState<Marchand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tarifsOuverts, setTarifsOuverts] = useState(false);
  const [fraisLivraison, setFraisLivraison] = useState('');
  const [fraisRetour, setFraisRetour] = useState('');

  async function load() {
    try {
      const m = await apiGet<Marchand>(`/api/marchands/${id}`);
      setMarchand(m);
      // Les champs de saisie reflètent l'état serveur à chaque rechargement :
      // vide signifie "aucun frais par défaut", et non zéro.
      setFraisLivraison(m.fraisLivraison ?? '');
      setFraisRetour(m.fraisRetour ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function enregistrerTarifs(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPatch(`/api/marchands/${id}`, { fraisLivraison, fraisRetour });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function changerStatut(statut: string) {
    setError(null);
    try {
      await apiPatch(`/api/marchands/${id}/statut`, { statut });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function reinitialiserMotDePasse() {
    if (!marchand) return;
    setError(null);
    try {
      const res = await apiPost<{ secretTemporaire: string }>(`/api/utilisateurs/${marchand.utilisateurId}/reinitialiser-mot-de-passe`);
      window.alert(
        `Nouveau mot de passe temporaire pour "${marchand.nomBoutique}" : ${res.secretTemporaire}\n\nCommunique-le au marchand ; il pourra le changer après connexion.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function accederEspace() {
    setError(null);
    // Ouvre l'onglet tout de suite, à l'intérieur du gestionnaire de clic —
    // pas après le await ci-dessous, sinon les navigateurs ne rattachent plus
    // l'ouverture au geste utilisateur et bloquent silencieusement le popup.
    const onglet = window.open('', '_blank');
    try {
      // L'espace marchand vit sur un autre domaine racine : le back-office ne
      // peut pas y poser de cookie. L'API renvoie une URL de transfert à usage
      // unique (60 s) que l'onglet cible échange contre une vraie session.
      const { url } = await apiPost<{ url: string }>(`/api/marchands/${id}/impersonation`);
      if (onglet) {
        onglet.location.href = url;
      } else {
        setError("Le navigateur a bloqué l'ouverture du nouvel onglet. Autorisez les popups pour ce site puis réessayez.");
      }
    } catch (err) {
      onglet?.close();
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimer() {
    if (!marchand) return;
    if (!window.confirm(`Supprimer définitivement le compte "${marchand.nomBoutique}" ? Cette action est irréversible.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/marchands/${id}`);
      router.push('/admin/marchands');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  if (!marchand) {
    return <p className="opacity-60">{error ?? 'Chargement…'}</p>;
  }

  const u = marchand.utilisateur;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/marchands')} className="btn-outline flex items-center gap-1 px-2 py-1 text-xs">
            <ArrowLeft className="h-3 w-3" />
            Retour
          </button>
          <h1 className="page-title">{marchand.nomBoutique}</h1>
          <StatutBadge statut={marchand.statut} />
        </div>
        <div className="flex flex-wrap gap-2">
          {marchand.statut === 'actif' ? (
            <button onClick={accederEspace} className="btn-outline flex items-center gap-1 px-2 py-1 text-xs">
              <ExternalLink className="h-3 w-3" />
              Accéder à l&apos;espace
            </button>
          ) : (
            <button onClick={() => changerStatut('actif')} className="btn-outline px-2 py-1 text-xs">
              Approuver
            </button>
          )}
          {marchand.statut !== 'suspendu' && (
            <button onClick={() => changerStatut('suspendu')} className="btn-outline px-2 py-1 text-xs">
              Suspendre
            </button>
          )}
          <button onClick={reinitialiserMotDePasse} className="btn-outline px-2 py-1 text-xs">
            Réinitialiser mot de passe
          </button>
          <button onClick={supprimer} className="btn-outline px-2 py-1 text-xs text-red-600 dark:text-red-400">
            Supprimer
          </button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="dashboard-card flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Titulaire du compte</h2>
          <div className="grid grid-cols-2 gap-4">
            <Champ label="Nom complet" value={u?.nomComplet} />
            <Champ label="Téléphone" value={u?.telephone} />
            <Champ label="Email" value={u?.email} />
            <Champ label="Compte activé" value={u?.actif ? 'Oui' : 'Non'} />
            <Champ label="Créé le" value={u?.dateCreation ? new Date(u.dateCreation).toLocaleString('fr-FR') : null} />
            <Champ label="Dernière connexion" value={u?.derniereConnexion ? new Date(u.derniereConnexion).toLocaleString('fr-FR') : 'Jamais'} />
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Activité</h2>
          <Champ label="Commandes" value={marchand._count?.commandes} />
          <Champ label="Ramassages" value={marchand._count?.ramassages} />
          <Champ label="Marchandises au catalogue" value={marchand._count?.marchandises} />
        </div>

        {/* § Facturation marchand : ces deux montants s'appliquent partout où
            aucune ligne de la grille par ville n'existe. Tant qu'ils sont
            vides, une facture ne déduit aucun frais et verse au marchand
            l'intégralité du COD — d'où l'avertissement explicite. */}
        <div className="dashboard-card flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Tarifs facturés</h2>
            <button type="button" className="btn-outline text-xs" onClick={() => setTarifsOuverts(true)}>
              Grille par ville
            </button>
          </div>
          <form onSubmit={enregistrerTarifs} className="flex flex-wrap items-end gap-4">
            <Field label="Frais de livraison" className="w-36">
              <Affix suffix="DH">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  className="input-bare"
                  value={fraisLivraison}
                  onChange={(e) => setFraisLivraison(e.target.value)}
                />
              </Affix>
            </Field>
            <Field label="Frais de retour" className="w-36">
              <Affix suffix="DH">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  className="input-bare"
                  value={fraisRetour}
                  onChange={(e) => setFraisRetour(e.target.value)}
                />
              </Affix>
            </Field>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </form>
          {!marchand.fraisLivraison && !marchand.fraisRetour && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Aucun frais par défaut : les factures de ce marchand lui reverseront la totalité du COD.
            </p>
          )}
        </div>

        <div className="dashboard-card flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Identité & légal</h2>
          <div className="grid grid-cols-2 gap-4">
            <Champ label="Type de compte" value={LABELS_TYPE_COMPTE[marchand.typeCompte]} />
            <Champ label="CIN" value={marchand.cin} />
            <Champ label="Raison sociale" value={marchand.raisonSociale} />
            <Champ label="ICE / RC" value={marchand.iceRc} />
            <Champ label="Registre de commerce" value={marchand.registreCommerce} />
            <Champ label="Site web" value={marchand.siteWeb} />
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Adresse & ramassage</h2>
          <Champ label="Ville" value={marchand.ville} />
          <Champ label="Adresse" value={marchand.adresse} />
          <Champ label="Ville de ramassage" value={marchand.villeRamassage} />
          <Champ label="Ramassage récurrent" value={marchand.ramassageRecurrentActif ? 'Actif' : 'Inactif'} />
          {marchand.ramassageRecurrentActif && (
            <>
              <Champ label="Jours" value={marchand.ramassageJours} />
              <Champ label="Créneau" value={marchand.ramassageCreneauHoraire} />
            </>
          )}
        </div>

        <div className="dashboard-card flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Informations bancaires</h2>
          <div className="grid grid-cols-2 gap-4">
            <Champ label="Banque" value={marchand.nomBanque} />
            <Champ label="RIB" value={marchand.rib} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide opacity-50">Justificatif RIB</span>
            {marchand.ribPhotoUrl ? (
              <a href={marchand.ribPhotoUrl} target="_blank" rel="noreferrer" className="w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={marchand.ribPhotoUrl}
                  alt="Justificatif RIB"
                  className="max-h-48 w-auto rounded-lg border border-black/10 dark:border-white/10"
                />
              </a>
            ) : (
              <span className="text-sm opacity-40">Aucun justificatif fourni</span>
            )}
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Adresses de collecte</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {marchand.adresses?.map((a) => (
              <li key={a.id} className="rounded-lg border-l-4 border-brand bg-black/5 px-3 py-2 dark:bg-white/5">
                <strong>{a.libelle}</strong> — {a.adresseComplete} {a.estParDefaut && '(par défaut)'}
              </li>
            ))}
            {(!marchand.adresses || marchand.adresses.length === 0) && <li className="opacity-40">Aucune adresse</li>}
          </ul>
        </div>

        <div className="dashboard-card flex flex-col gap-3 lg:col-span-3">
          <h2 className="text-sm font-black uppercase tracking-wide opacity-60">Équipe (membres invités)</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {marchand.membres?.map((mb) => (
              <li key={mb.id}>
                {mb.utilisateur.nomComplet} — {mb.utilisateur.email ?? '—'} {!mb.utilisateur.actif && '(désactivé)'}
              </li>
            ))}
            {(!marchand.membres || marchand.membres.length === 0) && <li className="opacity-40">Aucun membre invité</li>}
          </ul>
        </div>
      </div>

      {tarifsOuverts && (
        <TarifsMarchandModal
          marchandId={marchand.id}
          nomBoutique={marchand.nomBoutique}
          onClose={() => setTarifsOuverts(false)}
        />
      )}
    </div>
  );
}
