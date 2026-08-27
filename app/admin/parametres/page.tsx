'use client';

import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api-client';
import type { ParametresSociete } from '@/lib/types';

// § /admin/parametres — identité de la société imprimée sur tous les
// documents sortants (fiche de paie, facture, bons). Voir le commentaire du
// modèle ParametresSociete : ces champs étaient auparavant écrits en dur dans
// six pages d'impression.

const CHAMPS: { cle: keyof ParametresSociete; label: string; placeholder: string; aide?: string }[] = [
  { cle: 'raisonSociale', label: 'Raison sociale', placeholder: 'Mathio Delivery' },
  { cle: 'adresse', label: 'Adresse', placeholder: '12 rue Ibn Batouta, Casablanca' },
  { cle: 'telephone', label: 'Téléphone', placeholder: '0600000000' },
  { cle: 'email', label: 'Email', placeholder: 'contact@exemple.com' },
  { cle: 'siteWeb', label: 'Site web', placeholder: 'https://exemple.com' },
];

const VIDE: ParametresSociete = {
  raisonSociale: '',
  adresse: null,
  telephone: null,
  email: null,
  siteWeb: null,
  logoUrl: null,
};

export default function ParametresPage() {
  const [valeurs, setValeurs] = useState<ParametresSociete>(VIDE);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [charge, setCharge] = useState(false);

  useEffect(() => {
    apiGet<ParametresSociete>('/api/parametres/societe')
      .then((res) => {
        setValeurs(res);
        setCharge(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  async function enregistrer() {
    setEnCours(true);
    setError(null);
    setInfo(null);
    try {
      await apiPut('/api/parametres/societe', valeurs);
      setInfo('Paramètres enregistrés. Les documents imprimés reprennent ces informations immédiatement.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(false);
    }
  }

  // Le logo est stocké en data URL, même convention que les signatures et les
  // preuves de livraison : ce projet n'a pas de stockage objet. D'où la limite
  // de taille — une image de 2 Mo encodée en base64 alourdirait chaque
  // document de 2,7 Mo.
  function chargerLogo(fichier: File) {
    if (fichier.size > 300 * 1024) {
      setError('Le logo ne doit pas dépasser 300 Ko (il est stocké dans la base, pas sur un disque).');
      return;
    }
    const lecteur = new FileReader();
    lecteur.onload = () => setValeurs((v) => ({ ...v, logoUrl: String(lecteur.result) }));
    lecteur.readAsDataURL(fichier);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Settings className="h-6 w-6 text-brand-ink dark:text-brand" />
          Paramètres — Société
        </h1>
        <p className="mt-1 text-sm opacity-70">
          Ces informations s&apos;impriment en en-tête de la fiche de paie livreur, de la facture marchand et
          de tous les bons.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {info && <p className="text-sm font-medium text-green-700 dark:text-green-400">{info}</p>}

      <div className="flex flex-col gap-3">
        {CHAMPS.map((champ) => (
          <label key={champ.cle} className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide opacity-60">{champ.label}</span>
            <input
              className="input-basic"
              value={(valeurs[champ.cle] as string | null) ?? ''}
              placeholder={champ.placeholder}
              onChange={(e) => setValeurs((v) => ({ ...v, [champ.cle]: e.target.value }))}
            />
          </label>
        ))}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide opacity-60">Logo</span>
          <div className="flex items-center gap-3">
            {valeurs.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data URL
              <img
                src={valeurs.logoUrl}
                alt="Logo actuel"
                className="h-12 w-auto rounded border border-black/10 object-contain dark:border-white/15"
              />
            )}
            <input
              type="file"
              accept="image/*"
              className="text-sm"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                if (fichier) chargerLogo(fichier);
              }}
            />
            {valeurs.logoUrl && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => setValeurs((v) => ({ ...v, logoUrl: null }))}
              >
                Retirer
              </button>
            )}
          </div>
          <span className="text-xs opacity-60">PNG ou JPG, 300 Ko maximum.</span>
        </label>
      </div>

      <div>
        <button
          type="button"
          className="btn-primary"
          disabled={enCours || !charge || !valeurs.raisonSociale.trim()}
          onClick={enregistrer}
        >
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
