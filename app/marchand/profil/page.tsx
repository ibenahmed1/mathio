'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { AdresseMarchand, Marchand } from '@/lib/types';
import { SupportProfilSubNav } from '../SupportProfilSubNav';
import { EquipeSection } from './EquipeSection';

export default function MarchandProfilPage() {
  const [marchand, setMarchand] = useState<Marchand | null>(null);
  const [adresses, setAdresses] = useState<AdresseMarchand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [estTitulaire, setEstTitulaire] = useState(false);
  const [nouvelleAdresse, setNouvelleAdresse] = useState({ libelle: '', adresseComplete: '' });

  async function load() {
    try {
      const [m, a, moi] = await Promise.all([
        apiGet<Marchand>('/api/marchands/me'),
        apiGet<{ data: AdresseMarchand[] }>('/api/adresses'),
        apiGet<{ marchand?: { id: string } | null }>('/api/auth/me'),
      ]);
      setMarchand(m);
      setAdresses(a.data);
      // Seul le titulaire direct du compte (pas un membre invité) gère
      // l'équipe — voir /api/marchands/membres, réservé au même critère.
      setEstTitulaire(Boolean(moi.marchand));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!marchand) return;
    setError(null);
    setSaved(false);
    try {
      const updated = await apiPatch<Marchand>('/api/marchands/me', {
        nomBoutique: marchand.nomBoutique,
        ville: marchand.ville,
        ramassageRecurrentActif: marchand.ramassageRecurrentActif,
        ramassageJours: marchand.ramassageJours,
        ramassageCreneauHoraire: marchand.ramassageCreneauHoraire,
      });
      setMarchand(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleAddAdresse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPost('/api/adresses', nouvelleAdresse);
      setNouvelleAdresse({ libelle: '', adresseComplete: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  if (!marchand) {
    return <p className="opacity-60">{error ?? 'Chargement…'}</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Support & Profil</h1>
        <SupportProfilSubNav />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-black">Profil boutique</h2>
        <form onSubmit={handleSave} className="flex max-w-md flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nom de la boutique
            <input
              className="input-basic"
              value={marchand.nomBoutique}
              onChange={(e) => setMarchand({ ...marchand, nomBoutique: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ville
            <input
              className="input-basic"
              value={marchand.ville ?? ''}
              onChange={(e) => setMarchand({ ...marchand, ville: e.target.value })}
            />
          </label>

          <fieldset className="rounded-lg border border-brand p-3">
            <legend className="rounded bg-brand px-2 text-sm font-bold text-brand-foreground">Ramassage récurrent</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marchand.ramassageRecurrentActif}
                onChange={(e) => setMarchand({ ...marchand, ramassageRecurrentActif: e.target.checked })}
              />
              Activer la planification automatique
            </label>
            <label className="mt-2 flex flex-col gap-1 text-sm">
              Jours (ex. lun,mar,mer,jeu,ven)
              <input
                className="input-basic"
                value={marchand.ramassageJours ?? ''}
                onChange={(e) => setMarchand({ ...marchand, ramassageJours: e.target.value })}
              />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-sm">
              Créneau horaire (ex. 17:00-19:00)
              <input
                className="input-basic"
                value={marchand.ramassageCreneauHoraire ?? ''}
                onChange={(e) => setMarchand({ ...marchand, ramassageCreneauHoraire: e.target.value })}
              />
            </label>
          </fieldset>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          {saved && <p className="text-sm font-medium text-green-700">Enregistré.</p>}
          <button type="submit" className="btn-primary">
            Enregistrer
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-black">Adresses de collecte</h2>
        <ul className="mb-4 flex flex-col gap-1 text-sm">
          {adresses.map((a) => (
            <li key={a.id} className="rounded-lg border-l-4 border-brand bg-black/5 px-3 py-2 dark:bg-white/5">
              <strong>{a.libelle}</strong> — {a.adresseComplete} {a.estParDefaut && '(par défaut)'}
            </li>
          ))}
          {adresses.length === 0 && <li className="opacity-60">Aucune adresse</li>}
        </ul>
        <form onSubmit={handleAddAdresse} className="flex max-w-md flex-col gap-2">
          <input
            className="input-basic"
            placeholder="Libellé (ex. Entrepôt)"
            value={nouvelleAdresse.libelle}
            onChange={(e) => setNouvelleAdresse({ ...nouvelleAdresse, libelle: e.target.value })}
            required
          />
          <input
            className="input-basic"
            placeholder="Adresse complète"
            value={nouvelleAdresse.adresseComplete}
            onChange={(e) => setNouvelleAdresse({ ...nouvelleAdresse, adresseComplete: e.target.value })}
            required
          />
          <button type="submit" className="btn-outline w-fit">
            Ajouter l&apos;adresse
          </button>
        </form>
      </div>

      {estTitulaire && <EquipeSection />}
    </div>
  );
}
