'use client';

import { useState } from 'react';
import { apiPatch } from '@/lib/api-client';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';
import type { CleApi } from '@/lib/types';

// Réglages d'une clé déjà émise : libellé et quota, rien d'autre.
//
// Ni les scopes ni l'environnement. Élargir les scopes d'une clé déjà déployée
// chez un tiers lui donnerait un pouvoir qu'il n'a pas demandé, sans que rien
// ne le lui signale : la clé qu'il a en main ne change pas, seul ce qu'elle
// ouvre change. Le geste honnête est « émettre une nouvelle clé, expirer
// l'ancienne » — le partenaire voit passer la rotation. La règle est tenue côté
// serveur (modifierCleApi, lib/plateformes.ts) ; cet écran n'en est que la
// forme visible.
export function ModaleModifierCle({
  plateformeId,
  cle,
  onClose,
  onEnregistre,
}: {
  plateformeId: string;
  cle: CleApi;
  onClose: () => void;
  onEnregistre: () => void;
}) {
  const [libelle, setLibelle] = useState(cle.libelle ?? '');
  const [quota, setQuota] = useState(String(cle.quotaParMinute));
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await apiPatch(`/api/plateformes/${plateformeId}/cles/${cle.id}`, {
        action: 'modifier',
        libelle: libelle.trim() || null,
        quotaParMinute: Number(quota),
      });
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Modification impossible');
    } finally {
      setEnvoi(false);
    }
  }

  const quotaValide = Number.isInteger(Number(quota)) && Number(quota) > 0;

  return (
    <Modal title={`Clé mtk_${cle.environnement}_${cle.prefixe}…`} onClose={onClose} size="sm">
      <form onSubmit={soumettre} className="flex flex-col gap-4">
        <Field label="Libellé" optional hint="Pour vous repérer entre deux clés pendant une rotation.">
          <input
            className="input-basic"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Production — rotation septembre"
            autoFocus
          />
        </Field>

        <Field
          label="Quota par minute"
          required
          hint="Brider une intégration qui s’emballe ne doit pas demander un déploiement : ce plafond se corrige à chaud."
        >
          <input
            className="input-basic"
            type="number"
            min={1}
            step={1}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            required
          />
        </Field>

        <p className="text-xs text-black/50 dark:text-white/50">
          Le périmètre et l’environnement ne se modifient pas : les élargir sur une clé déjà
          déployée changerait ce qu’elle peut faire sans que le partenaire en soit averti. Pour cela,
          émettre une nouvelle clé et expirer celle-ci.
        </p>

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={envoi || !quotaValide}>
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );
}
