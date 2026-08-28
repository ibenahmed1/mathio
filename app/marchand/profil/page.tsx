'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { AdresseMarchand, Marchand } from '@/lib/types';
import { VILLES_RAMASSAGE, BANQUES_MAROC } from '@/lib/marchand-form-options';
import { readFileAsDataUrl } from '@/lib/read-file';
import { Field, FormSection } from '@/components/form/Field';
import { SupportProfilSubNav } from '../SupportProfilSubNav';
import { EquipeSection } from './EquipeSection';

export default function MarchandProfilPage() {
  const [marchand, setMarchand] = useState<Marchand | null>(null);
  const [adresses, setAdresses] = useState<AdresseMarchand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [estTitulaire, setEstTitulaire] = useState(false);
  const [nouvelleAdresse, setNouvelleAdresse] = useState({ libelle: '', adresseComplete: '' });
  const [nouvelleRibPhoto, setNouvelleRibPhoto] = useState<string | null>(null);
  const [nouvelleRibPhotoName, setNouvelleRibPhotoName] = useState<string | null>(null);

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
    Promise.resolve().then(() => load());
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
        raisonSociale: marchand.raisonSociale,
        iceRc: marchand.iceRc,
        cin: marchand.cin,
        siteWeb: marchand.siteWeb,
        adresse: marchand.adresse,
        nomBanque: marchand.nomBanque,
        rib: marchand.rib,
        registreCommerce: marchand.registreCommerce,
        villeRamassage: marchand.villeRamassage,
        ramassageRecurrentActif: marchand.ramassageRecurrentActif,
        ramassageJours: marchand.ramassageJours,
        ramassageCreneauHoraire: marchand.ramassageCreneauHoraire,
        ...(nouvelleRibPhoto ? { ribPhotoUrl: nouvelleRibPhoto } : {}),
        // Identifiants de connexion : seul le titulaire peut les modifier
        // (le backend re-vérifie de toute façon, cf. app/api/marchands/me/route.ts).
        ...(estTitulaire
          ? { telephone: marchand.utilisateur?.telephone, email: marchand.utilisateur?.email }
          : {}),
      });
      setMarchand(updated);
      setNouvelleRibPhoto(null);
      setNouvelleRibPhotoName(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleRibPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNouvelleRibPhotoName(file.name);
    setNouvelleRibPhoto(await readFileAsDataUrl(file));
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
        <form onSubmit={handleSave} className="flex max-w-2xl flex-col gap-4">
          <FormSection title="Boutique">
            <div className="form-grid">
              <Field label="Nom de la boutique">
                <input
                  className="input-basic"
                  value={marchand.nomBoutique}
                  onChange={(e) => setMarchand({ ...marchand, nomBoutique: e.target.value })}
                />
              </Field>
              <Field label="Ville">
                <input
                  className="input-basic"
                  value={marchand.ville ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, ville: e.target.value })}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Coordonnées de connexion">
            {estTitulaire ? (
              <div className="form-grid">
                <Field label="Téléphone">
                  <input
                    className="input-basic"
                    type="tel"
                    placeholder="06XXXXXXXX"
                    value={marchand.utilisateur?.telephone ?? ''}
                    onChange={(e) =>
                      setMarchand({ ...marchand, utilisateur: { ...marchand.utilisateur!, telephone: e.target.value } })
                    }
                  />
                </Field>
                <Field label="Adresse électronique">
                  <input
                    className="input-basic"
                    type="email"
                    value={marchand.utilisateur?.email ?? ''}
                    onChange={(e) =>
                      setMarchand({ ...marchand, utilisateur: { ...marchand.utilisateur!, email: e.target.value } })
                    }
                  />
                </Field>
              </div>
            ) : (
              <p className="form-hint">
                Téléphone : {marchand.utilisateur?.telephone ?? '—'} · Email : {marchand.utilisateur?.email ?? '—'}
                <br />
                Géré par le titulaire du compte, pas modifiable depuis un profil membre d&apos;équipe.
              </p>
            )}
          </FormSection>

          <FormSection title="Identité &amp; légal">
            <div className="form-grid">
              <Field label="CIN">
                <input
                  className="input-basic"
                  value={marchand.cin ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, cin: e.target.value })}
                />
              </Field>
              <Field label="Raison sociale">
                <input
                  className="input-basic"
                  value={marchand.raisonSociale ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, raisonSociale: e.target.value })}
                />
              </Field>
              <Field label="ICE / RC">
                <input
                  className="input-basic"
                  value={marchand.iceRc ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, iceRc: e.target.value })}
                />
              </Field>
              <Field label="Registre de commerce">
                <input
                  className="input-basic"
                  value={marchand.registreCommerce ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, registreCommerce: e.target.value })}
                />
              </Field>
              <Field label="Site web">
                <input
                  className="input-basic"
                  value={marchand.siteWeb ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, siteWeb: e.target.value })}
                />
              </Field>
              <Field label="Ville de ramassage">
                <select
                  className="input-basic"
                  value={marchand.villeRamassage ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, villeRamassage: e.target.value })}
                >
                  <option value="">—</option>
                  {VILLES_RAMASSAGE.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Adresse" className="sm:col-span-2">
                <input
                  className="input-basic"
                  value={marchand.adresse ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, adresse: e.target.value })}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Informations bancaires">
            <div className="form-grid">
              <Field label="Banque">
                <select
                  className="input-basic"
                  value={marchand.nomBanque ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, nomBanque: e.target.value })}
                >
                  <option value="">—</option>
                  {BANQUES_MAROC.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="RIB" hint="24 chiffres">
                <input
                  className="input-basic"
                  value={marchand.rib ?? ''}
                  inputMode="numeric"
                  maxLength={24}
                  onChange={(e) => setMarchand({ ...marchand, rib: e.target.value.replace(/\D/g, '').slice(0, 24) })}
                />
              </Field>
            </div>
            <div className="form-field">
              <span className="form-label">Justificatif RIB</span>
              {marchand.ribPhotoUrl && !nouvelleRibPhoto && (
                <a href={marchand.ribPhotoUrl} target="_blank" rel="noreferrer" className="w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={marchand.ribPhotoUrl}
                    alt="Justificatif RIB actuel"
                    className="max-h-32 w-auto rounded-lg border border-black/10 dark:border-white/10"
                  />
                </a>
              )}
              <label className="flex flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/60 shadow-sm dark:border-white/15 dark:bg-white/[0.06] dark:text-white/60">
                <span className="shrink-0 rounded-lg border border-black/20 bg-black/[0.04] px-3 py-1 font-semibold text-black dark:border-white/25 dark:bg-white/10 dark:text-white">
                  Changer le fichier
                </span>
                <span className="min-w-0 truncate">{nouvelleRibPhotoName ?? 'Aucun nouveau fichier sélectionné'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleRibPhotoChange} />
              </label>
            </div>
          </FormSection>

          <FormSection title="Ramassage récurrent">
            <label className="check-row">
              <input
                type="checkbox"
                className="check-basic"
                checked={marchand.ramassageRecurrentActif}
                onChange={(e) => setMarchand({ ...marchand, ramassageRecurrentActif: e.target.checked })}
              />
              Activer la planification automatique
            </label>
            <div className="form-grid">
              <Field label="Jours" hint="Ex. lun,mar,mer,jeu,ven">
                <input
                  className="input-basic"
                  value={marchand.ramassageJours ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, ramassageJours: e.target.value })}
                />
              </Field>
              <Field label="Créneau horaire" hint="Ex. 17:00-19:00">
                <input
                  className="input-basic"
                  value={marchand.ramassageCreneauHoraire ?? ''}
                  onChange={(e) => setMarchand({ ...marchand, ramassageCreneauHoraire: e.target.value })}
                />
              </Field>
            </div>
          </FormSection>

          {error && <p className="form-error">{error}</p>}
          {saved && <p className="text-xs font-semibold text-green-700 dark:text-green-400">Enregistré.</p>}
          <div className="form-actions">
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </div>
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
        <form onSubmit={handleAddAdresse} className="form-section max-w-2xl">
          <div className="form-grid">
            <Field label="Libellé" required hint="Ex. Entrepôt">
              <input
                className="input-basic"
                value={nouvelleAdresse.libelle}
                onChange={(e) => setNouvelleAdresse({ ...nouvelleAdresse, libelle: e.target.value })}
                required
              />
            </Field>
            <Field label="Adresse complète" required>
              <input
                className="input-basic"
                value={nouvelleAdresse.adresseComplete}
                onChange={(e) => setNouvelleAdresse({ ...nouvelleAdresse, adresseComplete: e.target.value })}
                required
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-outline">
              Ajouter l&apos;adresse
            </button>
          </div>
        </form>
      </div>

      {estTitulaire && <EquipeSection />}
    </div>
  );
}
